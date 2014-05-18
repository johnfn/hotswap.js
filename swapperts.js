/// <reference path="typings/esprima/esprima.d.ts" />
/// <reference path="typings/jquery/jquery.d.ts" />

/*
Why doesn't this work? :/
declare var escodegen {
function generate(ast:esprima.Syntax.Program);
};
*/
// Eventually this will be a more complicated namespacing thing.
// But for now...
var FunctionFinder = (function () {
    function FunctionFinder() {
    }
    return FunctionFinder;
})();

var ASTDescender = (function () {
    function ASTDescender(ast, callbacks) {
        this.callbacks = callbacks;

        this.instrument_ast(ast);
        this.result = ast;
    }
    ASTDescender.prototype.ast = function () {
        return this.result;
    };

    /*
    * After `instrument_ast`, the rest of the functions in this class will be dynamically dispatched
    * from `instrument_ast` as we recursively descend the AST, based on the type of the
    * node. This is many so we can take advantage of the types without having to invent
    * new variables for each recasted variable, as we might if we had a case or long if
    * statement.
    */
    ASTDescender.prototype.instrument_ast = function (ast) {
        var dispatch_name = "instrument_" + ast.type;

        if (this[dispatch_name]) {
            if (this.callbacks[ast.type]) {
                this.callbacks[ast.type](ast);
            }

            this[dispatch_name](ast);
        } else {
            console.log("(instrument_ast) dispatch not found for ", dispatch_name);
        }
    };

    // Helper for the recursive functions.
    ASTDescender.prototype.instrument_list = function (list) {
        for (var i = 0; i < list.length; i++) {
            this.instrument_ast(list[i]);
        }
    };

    // e.g. "a"
    ASTDescender.prototype.instrument_Identifier = function (ast) {
    };

    // e.g. "7"
    ASTDescender.prototype.instrument_Literal = function (ast) {
    };

    // e.g. "console.log"
    ASTDescender.prototype.instrument_MemberExpression = function (ast) {
        // TODO:
        //
        // Maybe what would be best would be to do something like var a = function(){}; gets rewritten to also have a.id = genUID() after it (comma operator brah)
        // More precisely, (var a = function(){}, a.id=genUID(), FN_TABLE[a.id] = a, a); (as to correctly return the function)
        // Then lookups would be like this: a() turns into FN_TABLE[a.id]() and herp.derp just becomes FN_TABLE[herp.derp.id]().
        //
        // The only thing left is to wrap the lookup in an anonymous function so it doesn't become "cached" in cases like setTimeout. e.g.
        //
        // setTimeout(a) becomes setTimeout(function(){ return FN_TABLE[a.id]; })
        //
        // This is only necessary when passing around uncalled functions.
        // That would work, I think. (Famous last words.)
    };

    ASTDescender.prototype.instrument_FunctionDeclaration = function (ast) {
        this.instrument_list(ast.body);
    };

    ASTDescender.prototype.instrument_VariableDeclarator = function (ast) {
    };

    ASTDescender.prototype.instrument_VariableDeclaration = function (ast) {
        this.instrument_list(ast.declarations);
    };

    ASTDescender.prototype.instrument_ExpressionStatement = function (ast) {
        this.instrument_ast(ast.expression);
    };

    ASTDescender.prototype.instrument_AssignmentExpression = function (ast) {
        this.instrument_list([ast.left, ast.right]);
    };

    ASTDescender.prototype.instrument_CallExpression = function (ast) {
        this.instrument_ast(ast.callee);
        this.instrument_list(ast.arguments);
    };

    ASTDescender.prototype.instrument_BlockStatement = function (ast) {
        this.instrument_list(ast.body);
    };

    ASTDescender.prototype.instrument_Program = function (ast) {
        this.instrument_list(ast.body);
    };

    ASTDescender.prototype.instrument_FunctionExpression = function (ast) {
        this.instrument_ast(ast.body);
    };
    return ASTDescender;
})();

/*
* Given a normal JS file passed in as a string:
*
* 1. Give every function a unique id.
* 2. Store each function in a table by that unique id.
* 3. Rewrite lookups to use the table and the unique id.
*
* This means we can hotswap in new function definitions later
* simply by updating the table.
*/
var Instrumentor = (function () {
    function Instrumentor(script) {
        this.script = script;
    }
    Instrumentor.prototype.instrument = function () {
        var ast = esprima.parse(this.script);

        var astd = new ASTDescender(ast, {
            "VariableDeclarator": function (ast) {
                if (ast.init.type == "FunctionExpression") {
                    ast.id.name = "$" + ast.id.name;
                }
            }
        });

        return astd.ast();
    };
    return Instrumentor;
})();

/*
* Scan script files for updates.
*/
var Scanner = (function () {
    function Scanner() {
        var _this = this;
        this.scripts = [];
        this.loaded_scripts = {};
        setInterval(function () {
            return _this.scan();
        }, 100);
    }
    Scanner.prototype.hotswap = function (script) {
        this.scripts.push(script);
    };

    Scanner.prototype.reload = function (new_script, old_script, file_name) {
        console.log("reload of " + file_name);

        var i = new Instrumentor(new_script);

        console.log(escodegen.generate(i.instrument()));
        // Attempt to find the location at which they differ, then walk the AST and find the corresponding node and mark it.
        // Then, find the enclosing function, rewrite it and reload it into the FN_TABLE.
        // A slightly better way to do this would be to directly diff the ASTs...
        /*
        var line_column = get_change_location(new_script, old_script);
        
        var ast = esprima.parse(new_script, {loc: true});
        
        var changed_function_ast = find_changed_function(ast, line_column[0], line_column[1]);
        
        var fn_body = escodegen.generate(changed_function_ast.declarations[0].init);
        var fn_name = changed_function_ast.declarations[0].id.name;
        var table_name = function_tables[file_name][fn_name];
        var instrumented_fn = instrument("___x = " + fn_body);// "___x = " is a hack to make it return the value. function declarations dont generally return anything.
        
        FN_TABLE[table_name] = eval(instrumented_fn);
        */
        //need to rewrite to use FN_TABLE via instrument()
    };

    Scanner.prototype.scan = function () {
        for (var i = 0; i < this.scripts.length; i++) {
            var script_name = this.scripts[i];
            var script = $.ajax({ url: script_name, async: false, dataType: 'text', cache: false }).responseText;

            if (!this.loaded_scripts[script_name]) {
                this.loaded_scripts[script_name] = script;

                var ins = new Instrumentor(script);
                console.log(escodegen.generate(ins.instrument()));
                // TODO enable the following once it's working.
                // $.globalEval(instrument(script, script_name, true));
            } else {
                if (this.loaded_scripts[script_name] != script) {
                    var old_script = this.loaded_scripts[script_name];

                    this.loaded_scripts[script_name] = script;

                    this.reload(script, old_script, script_name);
                }
            }
        }
    };
    return Scanner;
})();

if (typeof module === 'undefined') {
    var scanner = new Scanner();

    window['hotswap'] = scanner.hotswap.bind(scanner);
}
