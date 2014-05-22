/// <reference path="typings/esprima/esprima.d.ts" />
/// <reference path="typings/jquery/jquery.d.ts" />

var to_ast = function (s) {
    var ast = esprima.parse(s);

    // If it's just a simple statement, return it without curly brackets.
    if (ast.body.length == 1) {
        return ast.body[0];
    }

    // this is designed to be used nested within from_ast, but escodegen
    // gets (understandably) confused if it finds Program statements nested
    // within an AST. so we get rid of that.
    ast.type = "BlockStatement";
    return ast;
};

var from_ast = escodegen.generate;

/*
Why doesn't this work? :/
declare var escodegen {
function generate(ast:esprima.Syntax.Program);
};
*/
var ASTDescender = (function () {
    /*
    * If you call the onlyRecurseOn callback, the traversal will only recurse on the part of the AST
    * that you pass into the callback. This is designed to avoid infinite recursion if you modify
    * the AST to contain it's old self within some larger structure.
    * e.g. if you take {{ ast }} and do if (blah()) {{ ast }}, you should use this callback to avoid
    * stack overflows.
    */
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
        var self = this;

        if (this[dispatch_name]) {
            var onlyRecurse = false;

            if (this.callbacks[ast.type]) {
                this.callbacks[ast.type](ast, function (onlyThisAST) {
                    onlyRecurse = true;

                    dispatch_name = "instrument_" + ast.type; // we need to reassign because the callback could have changed the node type.
                    self[dispatch_name](ast);
                });
            }

            if (!onlyRecurse) {
                dispatch_name = "instrument_" + ast.type; // we need to reassign because the callback could have changed the node type.
                this[dispatch_name](ast);
            }
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

    ASTDescender.prototype.instrument_SequenceExpression = function (ast) {
        this.instrument_list(ast.expressions);
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
    Instrumentor.prototype.get_functions = function (ast) {
        var result = [];

        new ASTDescender(ast, {
            "VariableDeclarator": function (ast) {
                if (ast.init.type == "FunctionExpression") {
                    result.push(ast.id.name);
                }
            },
            "FunctionDeclaration": function (ast) {
                result.push(ast.id.name);
            }
        });

        return result;
    };

    Instrumentor.prototype.generate_ids = function (list) {
        var result = {};

        for (var i = 0; i < list.length; i++) {
            result[list[i]] = i;
        }

        return result;
    };

    Instrumentor.prototype.replace_node = function (target, replaceWith) {
        for (var key in target)
            delete target[key];
        for (var key in replaceWith)
            target[key] = replaceWith[key];
    };

    Instrumentor.prototype.instrument = function () {
        var ast = esprima.parse(this.script);
        var functions = this.get_functions(ast);

        // TODO: As long as we have this line, we're going to continue to have namespacing issues...
        var function_ids = this.generate_ids(functions);
        var self = this;
        var semicolon = ";";

        // TODO rewrite variable decls e.g var a=5, b=7 to be on separate lines.
        // This is because you can't rewrite var a=function(){} to be var FN_TABLE[...] -
        // you need to remove the var statement, and it would be even more confusing
        // with multiple decls on a single line.
        var astd = new ASTDescender(ast, {
            "VariableDeclaration": function (ast, onlyRecurseOn) {
                var decl = ast.declarations[0];

                if (decl.init.type == "FunctionExpression") {
                    onlyRecurseOn(decl);

                    self.replace_node(ast, to_ast("var " + from_ast(decl) + semicolon + decl.id.name + ".id = " + function_ids[decl.id.name] + semicolon + "FN_TABLE[" + decl.id.name + ".id" + "] = " + decl.id.name));
                }
            },
            "CallExpression": function (ast) {
                if (ast.callee.type == "Identifier") {
                    var id = ast.callee;
                    var fn_name = id.name;

                    if (fn_name in function_ids) {
                        self.replace_node(ast.callee, to_ast('FN_TABLE[' + fn_name + ".id" + ']').expression);
                    }
                }
            },
            "FunctionDeclaration": function (ast, onlyRecurseOn) {
                onlyRecurseOn(ast);

                // This introduces a block statement, but there isn't really a(n easy) way to get around that...
                self.replace_node(ast, to_ast(from_ast(ast) + semicolon + ast.id.name + ".id = " + function_ids[ast.id.name] + semicolon + "FN_TABLE[" + ast.id.name + ".id" + "] = " + ast.id.name));
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
