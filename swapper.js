
var scripts = document.getElementsByTagName("script");
var uris = [];
var loaded_scripts = {};
var function_name_to_lookup = {};

for (var i = 0; i < scripts.length; i++) {
  uris.push(scripts[i].getAttribute('src'));
}

uris = ["test.js"];

function assert(condition, message) {
    if (!condition) {
        throw message || "Assertion failed";
    }
}

var is_array = function(o) {
    return Object.prototype.toString.call(o) === '[object Array]';
}

var parse_variable_decls_for_function_names = function(decls) {
    var results = [];

    for (var i = 0; i < decls.length; i++) {
        var decl = decls[i];

        if (decl.type == "VariableDeclarator" && decl.init.type == "FunctionExpression") {
            results.push(decl.id.name);
        }
    }

    return results;
};

var uid=0;
var get_lookup = function(name) {
    if (! (name in function_name_to_lookup)) {
        function_name_to_lookup[name] = "FN_" + uid;
        ++uid;
    }

    return function_name_to_lookup[name];
}

var instrument_ast = function(ast) {
    var decls = [];

    if (ast.type == "Identifier") {
        var lookup = get_lookup(ast.name);

        if (lookup) {
            ast.name = "FN_TABLE['" + lookup + "']";
        }

        return;
    }

    if (ast.type == "ExpressionStatement") {
        instrument_ast(ast.expression);

        return;
    }

    if (ast.type === "VariableDeclaration") {
        var fn_names = parse_variable_decls_for_function_names(ast.declarations);

        if (fn_names.length > 1)  {
            console.err("wat, i can't do multiple definitions in the same declaration block... go away.");
        }

        var fn_name = fn_names[0];
        var rightside = escodegen.generate(ast.declarations[0].init);
        var leftside = "FN_TABLE['" + get_lookup(fn_name) + "']";

        var gen = esprima.parse(leftside + "=" + rightside);

        for (var key in ast) delete ast[key];
        for (var key in gen.body[0]) ast[key] = gen.body[0][key];

        return;
    }

    if (ast.body) {
        for (var i = 0; i < ast.body.length; i++) {
            instrument_ast(ast.body[i]);
        }
    }

    if (ast.arguments) {
        for (var i = 0; i < ast.arguments.length; i++) {
            instrument_ast(ast.arguments[i]);
        }
    }
};

var instrument = function(script) {
  var syntax = esprima.parse(script);

  console.log(JSON.stringify(syntax, null, 2));
  //return;

  instrument_ast(syntax);
  console.log(escodegen.generate(syntax));
  //console.log(JSON.stringify(function_name_to_lookup));
};

var get_change_location = function(new_script, old_script) {
    // Find line and column differences.

    var new_lines = new_script.split("\n");
    var old_lines = old_script.split("\n");
    var line = -1;
    var column = -1;

    for (line = 0; line < Math.min(new_lines.length, old_lines.length); line++) {
        if (new_lines[line] != old_lines[line]) {
            break;
        }
    }

    var new_line = new_lines[line];
    var old_line = old_lines[line];

    ++line; // lines are 1-indexed.

    for (column = 0; column < Math.min(new_line.length, old_line.length); column++) {
        if (new_line[column] != old_line[column]) {
            break;
        }
    }

    console.log("line: " + line + " column: " + column);

    return [line, column];
}

// returned changed fn.
var find_changed_function = function(ast, line, col) {
    var result;

    assert(line != undefined); assert(col != undefined);

    var loc = ast.loc;
    var good = (loc.start.line <= line && loc.end.line >= line);
    if (line == loc.start.line && loc == loc.end.line) {
        good == good && (loc.start.col <= col && loc.end.col >= col)
    }

    if (!good) return;

    if (ast.declarations && ast.declarations.length > 1) {
        console.err("holy crap multiple declarations time to die"); //TODO
    }

    if (ast.type == "VariableDeclaration" && ast.declarations[0].init.type == "FunctionExpression") {
        return ast;
    }

    if (ast.body) {
        for (var i = 0; i < ast.body.length; i++) {
            var result = find_changed_function(ast.body[i], line, col);

            if (result) return result;
        }
    }

    if (ast.arguments) {
        for (var i = 0; i < ast.arguments.length; i++) {
            var result = find_changed_function(ast.arguments[i], line, col);

            if (result) return result;
        }
    }

    console.log("fail to parse:: ", ast);
    return;
}

var reload = function(new_script, old_script) {
    // Attempt to find the location at which they differ, then walk the AST and find the corresponding node and mark it.
    // Then, find the enclosing function, rewrite it and reload it into the FN_TABLE.

    // A slightly better way to do this would be to directly diff the ASTs...

    var line_column = get_change_location(new_script, old_script);

    var ast = esprima.parse(new_script, {loc: true});

    console.log(escodegen.generate(find_changed_function(ast, line_column[0], line_column[1])));
};

var scan = function() {
  for (var i = 0; i < uris.length; i++) {
    var uri = uris[i];
    var script = $.ajax({url: uri, async: false, dataType: 'text' }).responseText; // Fun fax: if you don't flag it as text, jQuery will "intelligently" assume it to be javascript and recursively eval the same file over and over until the browser crashes.

    if (!loaded_scripts[uri]) {
      loaded_scripts[uri] = script;

      instrument(script);
    } else {
      if (loaded_scripts[uri] != script) {
        console.log("reload of " + uri);

        var old_script = loaded_scripts[uri];

        loaded_scripts[uri] = script;

        reload(script, old_script);
      }
    }
  }
};

setInterval(scan, 100);