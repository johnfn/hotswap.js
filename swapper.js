
var scripts = document.getElementsByTagName("script");
var uris = [];
var loaded_scripts = {};

for (var i = 0; i < scripts.length; i++) {
	uris.push(scripts[i].getAttribute('src'));
}

var scan = function() {
	for (var i = 0; i < uris.length; i++) {
		var uri = uris[i];
		var script = $.ajax({url: uri, async: false, dataType: 'text' }).responseText; // Fun fax: if you don't flag it as text, jQuery will "intelligently" assume it to be javascript and recursively eval the same file over and over until the browser crashes.

		if (!loaded_scripts[uri]) {
			loaded_scripts[uri] = script;
		} else {
			if (loaded_scripts[uri] != script) {
				console.log("reload of " + uri);

				loaded_scripts[uri] = script;
			}
		}
	}
};

setInterval(scan, 100);