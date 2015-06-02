/*
 * Copyright 2015 Haiku, Inc. All rights reserved.
 * Distributed under the terms of the MIT License.
 *
 * Authors:
 *		Augustin Cavalier <waddlesplash>
 */

var kArchitecture = ['x86', 'x86_64', 'x86_gcc2', 'arm', 'ppc'];

/*! toggles the contents and spinner areas */
function hideContents() {
	$('#pageContents').hide();
	$('#loading-placeholder').show();
}
function showContents() {
	$('#loading-placeholder').hide();
	$('#pageContents').show();
}

/*! sets the page <title> and <div id='pageTitle'> */
function setPageTitle(title, description) {
	$('title').html(title + ' | Haiku Kitchen');
	$('#pageTitle h2').html(title);
	$('#pageTitle p').html(description);
}

function pageLoadingFailed() {
	setPageTitle('Ack!', 'Something went wrong! <i class="fa fa-frown-o"></i> Try reloading the page.');
	showContents();
}

function fetchPageAndCall(pageUrl, func) {
	$.ajax(pageUrl, {dataType: 'text'})
		.done(function (data) {
			func(data);
		})
		.fail(pageLoadingFailed);
}

function showHomePage(data) {
	setPageTitle('Home', '');
	$('#pageContentsBody').html(data);
	showContents();
}

function showRecipesPage(data) {
	setPageTitle('Recipes', 'This is a complete listing of recipes known to the Haiku package build system:');
	$('#pageContentsBody').html(data);

	/* fetch recipe stats and add them to the table */
	$.ajax('/api/recipes')
		.done(function (data) {
			for (var i in data) {
				var html =
					'<tr><td><i class="fa fa-file-text-o"></i> ' + i + '</td>' +
					'<td>' + data[i].category + '</td>' +
					'<td>' + data[i].version + '</td>' +
					'<td>' + data[i].revision + '</td><td>';
				if (data[i].lint)
					html += '<i class="fa fa-check-circle"></i>';
				else
					html += '<i class="fa fa-times-circle"></i>';
				html += "</td>";
				for (var a in kArchitecture) {
					var arch = kArchitecture[a];
					html += "<td>";
					if (arch in data[i] && data[i][arch])
						html += '<a href="' + data[i][arch] + '"><i class="fa fa-archive"></i></a>';
					html += "</td>";
				}
				html += "</tr>";

				$("#recipesTableBody").append(html);
			}
			$("table.sortable").stupidtable();
			showContents();
		})
		.fail(pageLoadingFailed);
}

function showBuildersPage() {
	setPageTitle('Builders', '');

	$.ajax('/api/builders')
		.done(function (data) {
			$("#pageContentsBody").append('<div id="builderStats"></div>');
			var onlineBuilders = 0, totalBuilders = 0;
			for (var i in data) {
				totalBuilders++;
				if (data[i].online)
					onlineBuilders++;
				var html =
					'<div class="builder"><span class="heading"> ' + i + ' ';
				if (data[i].online)
					html += '<i class="fa fa-check-circle-o"></i>';
				else
					html += '<i class="fa fa-times-circle-o"></i>';
				html += '</span>&nbsp;&nbsp;<span>owned by ' + data[i].owner + '<br>' +
					'<a href="https://cgit.haiku-os.org/haiku/commit/?id=hrev' + data[i].hrev +
						'">hrev' + data[i].hrev + '</a>, ' +
					data[i].cores + ' cores, ' +
					data[i].architecture + ', ' +
					data[i].flavor + '</div>';
				$("#pageContentsBody").append(html);
			}
			setPageTitle('Builders', "<b>" + onlineBuilders +
				"</b> builders are online out of <b>" + totalBuilders + "</b>.");
			showContents();
		})
		.fail(pageLoadingFailed);
}

var currentHash = '';
function navigate(force) {
	if (currentHash == window.location.hash && !force)
		return;

	hideContents();
	$('#menu li').removeClass('active');
	$('#pageContentsBody').html('');
	switch (window.location.hash) {
	case '':
	case '#/':
		fetchPageAndCall('pages/home.html', showHomePage);
		break;
	case '#/recipes':
		$('#menu li.recipes').addClass('active');
		fetchPageAndCall('pages/recipes.html', showRecipesPage);
		break;
	case '#/builders':
		$('#menu li.builders').addClass('active');
		showBuildersPage();
		break;

	default:
		setPageTitle('404 Not Found', 'We can’t find that page! <i class="fa fa-frown-o"></i>');
		showContents();
		break;
	}
	currentHash = window.location.hash;
}

$(window).on('hashchange', function() {
	navigate();
});
$(function () {
	navigate(true);
});
