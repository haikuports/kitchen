/*
 * Copyright 2015 Haiku, Inc. All rights reserved.
 * Distributed under the terms of the MIT License.
 *
 * Authors:
 *		Augustin Cavalier <waddlesplash>
 */

var log = require('debug')('kitchen:index'), fs = require('fs'),
	PortsTree = require('./portstree.js'), BuildManager = require('./builds.js'),
	BuilderManager = require('./builders.js'), timers = require('timers');

var argv = require('minimist')(process.argv.slice(2));
if (argv['help']) {
	console.log('The Kitchen server.');
	console.log('Usage: index.js [options]');
	console.log('');
	console.log('Options:');
	console.log('  --port\tPort to start the HTTP listener on.');

	process.exit(0);
}
if (!('port' in argv)) {
	argv.port = 8080;
}

log("starting up");

/*! --------------------- haikuports tree --------------------- */
var portsTree = new PortsTree();
portsTree.update();
timers.setInterval(portsTree.update, 10 * 60 * 1000);

/*! --------------------- builds/builders --------------------- */
var builderManager = new BuilderManager();
var buildManager = new BuildManager(builderManager);

// find recipes that need to be linted & create a build if there are some
function createJobToLintRecipes(recipes) {
	var build = {
		description: 'lint unlinted recipes',
		noDependencyTracking: true,
		architecture: 'any',
		lastTime: new Date(),
		steps: [],
		handleResult: function (step, exitcode, output) {
			portsTree.recipes[step.split(' ')[2]].lint = (exitcode == 0);
			return true;
		},
		onSuccess: function () {
			portsTree._updateClientCache();
			portsTree._writeCache();
		}
	};
	for (var i in recipes) {
		build.steps.push('haikuporter --lint ' + recipes[i]);
	}
	buildManager.addBuild(build);
}
var recipesToLint = [];
for (var i in portsTree.recipes) {
	if (!('lint' in portsTree.recipes[i]))
		recipesToLint.push(i);
}
if (recipesToLint.length > 0)
	createJobToLintRecipes(recipesToLint);
portsTree.onRecipesChanged(function (recipes) {
	builderManager.updateAllHaikuportsTrees(function () {
		createJobToLintRecipes(recipes);
	});
});

/*! ------------------------ webserver ------------------------ */
var express = require('express'), app = express();
app.get('/api/recipes', function (request, response) {
	response.writeHead(200, {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'});
	response.end(portsTree.clientRecipes);
});
app.get('/api/builders', function (request, response) {
	var respJson = {};
	for (var i in builderManager.builders) {
		var builder = builderManager.builders[i];
		respJson[i] = {
			owner: builder.owner,
			hrev: builder.hrev,
			cores: builder.cores,
			architecture: builder.architecture,
			flavor: builder.flavor,
			status: builder.status
		};
	}
	response.writeHead(200, {'Content-Type': 'application/json'});
	response.end(JSON.stringify(respJson));
});
app.get('/api/builds', function (request, response) {
	response.writeHead(200, {'Content-Type': 'application/json'});
	response.end(JSON.stringify(buildManager.buildsSummary()));
});
app.get('/api/build/*', function (request, response) {
	var b = /[^/]*$/.exec(request.url)[0], build = buildManager.builds()[b];
	if (build == undefined) {
		response.writeHead(404, {'Content-Type': 'text/plain'});
		response.end('404 File Not Found');
		return;
	}

	var respJson = {
		id: build.id,
		status: build.status,
		description: build.description,
		lastTime: build.lastTime,
		steps: build.steps,
		curStep: build.curStep
	};
	response.writeHead(200, {'Content-Type': 'application/json'});
	response.end(JSON.stringify(respJson));
});
app.use(express.static('web'));
app.listen(argv['port']);
