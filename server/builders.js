/*
 * Copyright 2015 Haiku, Inc. All rights reserved.
 * Distributed under the terms of the MIT License.
 *
 * Authors:
 *		Augustin Cavalier <waddlesplash>
 */

var log = require('debug')('kitchen:builders'), fs = require('fs'),
	crypto = require('crypto');

if (!fs.existsSync('data/builders.json')) {
	log('FATAL: no builders configuration file! set one up using kitchen.js.');
	process.exit(1);
}

module.exports = function () {
	this.builders = JSON.parse(fs.readFileSync('data/builders.json',
		{encoding: 'UTF-8'})), thisThis = this;

	this.updateAllBuilders = function () {
		log('updating builders');
		var cmd = 'pkgman full-sync -y';
		for (var builderName in thisThis._builderSockets) {
			if (thisThis.builders[builderName].status != 'online')
				continue;
			thisThis.builders[builderName].status = 'busy';
			thisThis._builderSockets[builderName].write(JSON.stringify({
				what: 'command',
				command: 'pkgman full-sync -y',
				replyWith: 'updateResult'
			}) + '\n');
		}
	};

	this._updateHaikuportsTreeOn = function (builderName, callback) {
		if (thisThis.builders[builderName].status != 'online')
			return;
		log('updating haikuporter/haikuports trees on %s', builderName);
		var cmd = 'cd ~/haikuporter && git pull && cd ~/haikuports && git pull && cd ~';
		this.builders[builderName].status = 'busy';
		this.runCommandOn(builderName, cmd, function (exitcode, output) {
			if (exitcode == 0) {
				if (callback != undefined)
					callback();
			} else {
				log('git-pull on builder %s failed: %s', builderName, output.trim());
				thisThis.builders[builderName].status = 'broken';
			}
		});
	};
	this.updateAllHaikuportsTrees = function (callback) {
		var buildersToUpdate = 0, updated = 0;
		for (var i in thisThis._builderSockets) {
			buildersToUpdate++;
			thisThis._updateHaikuportsTreeOn(i, function () {
				updated++;
				if (updated == buildersToUpdate && callback != undefined)
					callback();
			});
		}
		if (buildersToUpdate == 0) {
			// No online builders, so just treat them as updated
			if (callback != undefined)
				callback();
		}
	};
	this._ensureHaikuportsTreeOn = function (builderName) {
		function treeIsReady() {
			log('haikuporter/haikuports clone/pull successful on %s', builderName);
			thisThis.runCommandOn(builderName, 'haikuporter', function (exitcode, output) {
				// Now that we've ensured there's an up-to-date HaikuPorts tree,
				// we can fire the 'builder connected' signal.
				if (thisThis.builders[builderName].status == 'busy') {
					thisThis.builders[builderName].status = 'online';
					if (thisThis._builderConnectedCallback != undefined) {
						thisThis._builderConnectedCallback(builderName);
					}
				}
			});
		}

		var cmd = 'ls ~/haikuporter/ && ls ~/haikuports/';
		this.runCommandOn(builderName, cmd, function (exitcode, output) {
			if (exitcode == 0) {
				// they're already there, just update them
				thisThis._updateHaikuportsTreeOn(builderName, treeIsReady);
				return;
			}
			// didn't exit with 0, probably means there's no haikuports/haikuporter
			log('cloning new haikuporter/haikuports trees on %s', builderName);
			cmd = 'cd ~ && git clone https://bitbucket.org/haikuports/haikuporter.git ' +
				'--depth=1 && git clone https://bitbucket.org/haikuports/haikuports.git --depth=1';
			thisThis.runCommandOn(builderName, cmd, function (exitcode, output) {
				if (exitcode == 0)
					treeIsReady();
				else {
					log('git-clone on builder %s failed: %s', builderName, output.trim());
					thisThis.builders[builderName].status = 'broken';
				}
			});

			var confFile = '~/config/settings/haikuports.conf';
			cmd = [
				'TREE_PATH=\\"/boot/home/haikuports\\"',
				'PACKAGER=\\"Haiku Kitchen \\<kitchen@server.fake\\>\\"'
				];
			cmd = cmd.join(' >>' + confFile + ' && echo ');
			cmd = 'rm -f ' + confFile + ' && echo ' + cmd + ' >>' + confFile;
			thisThis.runCommandOn(builderName, cmd, function (exitcode, output) {
				if (exitcode != 0) {
					log('attempt to create haikuports.conf on %s failed: %s',
						builderName, output.trim());
					thisThis.builders[builderName].status = 'broken';
				}
			});
		});
		this.runCommandOn(builderName, 'ln -s ~/haikuporter/haikuporter haikuporter');
	};

	this._builderSockets = {};
	this._runningCommands = {};
	this._nextCommandId = 0;
	this.runCommandOn = function (builderName, command, callback) {
		if (!(builderName in this.builders)) {
			throw 'Builder does not exist!';
		}
		var cmdId = 'cmd' + this._nextCommandId;
		this._nextCommandId++;
		this._runningCommands[cmdId] = {
			callback: callback
		};
		this._builderSockets[builderName].write(JSON.stringify({what: 'command',
			replyWith: cmdId, command: command}) + '\n');
	};

	this.onBuilderConnected = function (callback) {
		this._builderConnectedCallback = callback;
	};
	this._handleMessage = function (builderName, msg, sendJSON) {
		if (msg.what.indexOf('cmd') == 0) {
			if (!(msg.what in this._runningCommands)) {
				log('WARN: message returned for pending command that does ' +
					'not exist: builder %s, result: %s', builderName, JSON.stringify(msg));
			} else {
				var callback = this._runningCommands[msg.what].callback;
				if (callback !== undefined)
					callback(msg.exitcode, msg.output);
				delete this._runningCommands[msg.what];
			}
			return;
		}

		var builder = this.builders[builderName];
		switch (msg.what) {
		// information about the builder
		case 'coreCount':
			builder.cores = msg.count;
			break;
		case 'uname':
			var uname = msg.output.trim().split(' ');
			builder.hrev = uname[3].substr(4);
			builder.architecture = uname[10];
			break;
		case 'archlist':
			var archlist = msg.output.trim().replace(/\n/g, ' ');
			if (archlist == 'x86_gcc2 x86')
				builder.flavor = 'gcc2hybrid';
			else if (archlist == 'x86 x86_gcc2')
				builder.flavor = 'gcc4hybrid';
			else if (archlist == builder.architecture)
				builder.flavor = 'pure';
			else
				builder.flavor = 'unknown';
			break;

		case 'updateResult':
			if (msg.exitcode != 0) {
				log('update on builder %s failed, marking it as broken', builderName);
				builder.status = 'broken';
			} else if (msg.output.indexOf('Nothing to do.') >= 0) {
				// Already up-to-date.
				builder.status = 'online';
			} else {
				sendJSON({what: 'restart'});
			}
			break;

		case 'restarting':
		case 'ignore':
			break;
		default:
			log("WARN: couldn't understand this message from '%s': %s", name,
				JSON.stringify(msg));
			break;
		}
	};

	this._builderAuthenticated = function (sock, name) {
		function sendJSON(object) {
			sock.write(JSON.stringify(object) + '\n');
		}

		this.builders[name].status = 'busy';
		this._builderSockets[name] = sock;
		// startup stuff
		sendJSON({what: 'command', replyWith: 'ignore',
			command: 'hey Tracker quit'});
		sendJSON({what: 'command', replyWith: 'updateResult',
			command: 'pkgman full-sync -y'});
		// fetch builder info
		sendJSON({what: 'getCores'});
		sendJSON({what: 'command', replyWith: 'uname',
			command: 'uname -a'});
		sendJSON({what: 'command', replyWith: 'archlist',
			command: 'setarch -l'});
		this._ensureHaikuportsTreeOn(name);

		var thisThis = this, dataBuf = '', data;
		sock.on('data', function (dat) {
			dataBuf += dat.toString();
			data = dataBuf.split('\n');
			dataBuf = data[data.length - 1];
			delete data[data.length - 1];

			for (var i in data) {
				var msg = JSON.parse(data[i]);
				thisThis._handleMessage(name, msg, sendJSON);
			}
		});
		sock.on('close', function () {
			log("builder '%s' disconnected", name);
			delete thisThis._builderSockets[name];
			delete thisThis.builders[name].status;
			delete thisThis.builders[name].hrev;
			delete thisThis.builders[name].cores;
			delete thisThis.builders[name].architecture;
			delete thisThis.builders[name].flavor;
		});
	};

	var options = {
		key: fs.readFileSync('data/server.key'),
		cert: fs.readFileSync('data/server.crt')
	};
	var thisThis = this;
	require('tls').createServer(options, function (sock) {
		log('socket opened from %s', sock.remoteAddress);
		var msg = '';
		sock.on('data', function (data) {
			msg += data.toString();
			if (msg.indexOf('\n') < 0)
				return;

			msg = JSON.parse(msg);
			if (msg.what != 'auth') {
				log("AUTHFAIL: %s's first message is not 'auth'!",
					sock.remoteAddress);
				sock.destroy();
				return;
			}
			if (!(msg.name in thisThis.builders)) {
				log("AUTHFAIL: builder's name is '%s' but no known builders " +
					"with that name.", msg.name);
				sock.destroy();
				return;
			}

			// process key
			var hash = thisThis.builders[msg.name].keyHash.substr(0, 44),
				salt = thisThis.builders[msg.name].keyHash.substr(44),
				sha256sum = crypto.createHash('SHA256');
			sha256sum.update(msg.key + salt);
			var hashedKey = sha256sum.digest('base64');
			if (hashedKey != hash) {
				log("AUTHFAIL: hash for key of builder '%s' is '%s', " +
					"but '%s' was expected.", msg.name, hashedKey, hash);
				sock.destroy();
				return;
			}
			log("builder '%s' successfully authenticated from IP %s",
				msg.name, sock.remoteAddress);
			sock.removeAllListeners('data');
			thisThis._builderAuthenticated(sock, msg.name);
		});
		sock.write('\n'); // indicates to the builder we're ready
	}).listen(42458 /* HAIKU */);
};
