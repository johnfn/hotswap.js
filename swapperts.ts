/// <reference path="typings/esprima/esprima.d.ts" />
/// <reference path="typings/jquery/jquery.d.ts" />

declare var module;
declare var escodegen;

import E = esprima.Syntax;

var to_ast = function(s:string):E.Node {
  var ast:E.Program = esprima.parse(s);

  // If it's just a simple statement, return it without curly brackets.

  if (ast.body.length == 1) {
    return ast.body[0];
  }

  // this is designed to be used nested within from_ast, but escodegen
  // gets (understandably) confused if it finds Program statements nested
  // within an AST. so we get rid of that.

  ast.type = "BlockStatement";
  return ast;
}

var from_ast = escodegen.generate;

/*
Why doesn't this work? :/

declare var escodegen {
  function generate(ast:esprima.Syntax.Program);
};
*/

class ASTDescender {
  callbacks:{[key: string]: (ast:E.Node, onlyRecurse:any) => void};
  result:E.Program;

  /*
   * If you call the onlyRecurseOn callback, the traversal will only recurse on the part of the AST
   * that you pass into the callback. This is designed to avoid infinite recursion if you modify
   * the AST to contain it's old self within some larger structure.
   * e.g. if you take {{ ast }} and do if (blah()) {{ ast }}, you should use this callback to avoid
   * stack overflows.
   */
  constructor(ast:E.Program, callbacks:{[key: string]: (ast:E.Node, callback:any) => void}) {
    this.callbacks = callbacks;

    this.instrument_ast(ast);
    this.result = ast;
  }

  ast():E.Program {
    return this.result;
  }

  /*
   * After `instrument_ast`, the rest of the functions in this class will be dynamically dispatched
   * from `instrument_ast` as we recursively descend the AST, based on the type of the
   * node. This is many so we can take advantage of the types without having to invent
   * new variables for each recasted variable, as we might if we had a case or long if
   * statement.
   */
  instrument_ast(ast:E.Node) {
    var dispatch_name:string = "instrument_" + ast.type;
    var self = this;

    if (this[dispatch_name]) {
      var onlyRecurse:boolean = false;

      if (this.callbacks[ast.type]) {
        this.callbacks[ast.type](ast, function(onlyThisAST:E.Node) {
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
  }

  // Helper for the recursive functions.
  private instrument_list(list:E.Node[]) {
    for (var i = 0; i < list.length; i++) {
      this.instrument_ast(list[i]);
    }
  }
    // e.g. "a"
  private instrument_Identifier(ast:E.Identifier) {

  }

  // e.g. "7"
  private instrument_Literal(ast:E.Identifier) {
  }

  // e.g. "console.log"
  private instrument_MemberExpression(ast:E.Identifier) {

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
  }

  private instrument_FunctionDeclaration(ast:E.FunctionDeclaration) {
    this.instrument_list(ast.body);
  }

  private instrument_SequenceExpression(ast:E.SequenceExpression) {
    this.instrument_list(ast.expressions);
  }

  private instrument_VariableDeclarator(ast:E.VariableDeclarator) {
  }

  private instrument_VariableDeclaration(ast:E.VariableDeclaration) {
    this.instrument_list(ast.declarations);
  }

  private instrument_ExpressionStatement(ast:E.ExpressionStatement) {
    this.instrument_ast(ast.expression);
  }

  private instrument_AssignmentExpression(ast:E.AssignmentExpression) {
    this.instrument_list([ast.left, ast.right]);
  }

  private instrument_CallExpression(ast:E.CallExpression) {
    this.instrument_ast(ast.callee);
    this.instrument_list(ast.arguments);
  }

  private instrument_BlockStatement(ast:E.BlockStatement) {
    this.instrument_list(ast.body);
  }

  private instrument_Program(ast:E.Program) {
    this.instrument_list(ast.body);
  }

  private instrument_FunctionExpression(ast:E.FunctionExpression) {
    this.instrument_ast(ast.body);
  }
}

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
class Instrumentor {
  script: string;

  constructor(script:string) {
    this.script = script;
  }

  get_functions(ast:E.Program):string[] {
    var result:string[] = [];

    new ASTDescender(ast, {
      "VariableDeclarator" : function(ast: E.VariableDeclarator) {
        if (ast.init.type == "FunctionExpression") {
          result.push(ast.id.name);
        }
      },
      "FunctionDeclaration": function(ast: E.FunctionDeclaration) {
        result.push(ast.id.name);
      }
    });

    return result;
  }

  generate_ids(list:string[]): {[key: string]: number} {
    var result: {[key: string]: number} = {};

    for (var i = 0; i < list.length; i++) {
      result[list[i]] = i;
    }

    return result;
  }

  replace_node(target:E.Node, replaceWith:E.Node) {
    for (var key in target) delete target[key];
    for (var key in replaceWith) target[key] = replaceWith[key];
  }

  instrument():E.Program {
    var ast:E.Program = esprima.parse(this.script);
    var functions:string[] = this.get_functions(ast);
    // TODO: As long as we have this line, we're going to continue to have namespacing issues...
    var function_ids:{[key: string]: number} = this.generate_ids(functions);
    var self:Instrumentor = this;
    var semicolon:string = ";";

    // TODO rewrite variable decls e.g var a=5, b=7 to be on separate lines.
    // This is because you can't rewrite var a=function(){} to be var FN_TABLE[...] -
    // you need to remove the var statement, and it would be even more confusing
    // with multiple decls on a single line.

    var astd:ASTDescender = new ASTDescender(ast, {

      "VariableDeclaration" : function(ast: E.VariableDeclaration, onlyRecurseOn: (ast:E.Node) => void) {
        var decl = ast.declarations[0];

        if (decl.init.type == "FunctionExpression") {
          onlyRecurseOn(decl);

          self.replace_node(ast, to_ast(
            "var " + from_ast(decl) +
            semicolon + decl.id.name + ".id = " + function_ids[decl.id.name] +
            semicolon + "FN_TABLE[" + decl.id.name + ".id" + "] = " + decl.id.name
            ));
        }
      },

      "CallExpression": function(ast: E.CallExpression) {
        if (ast.callee.type == "Identifier") {
          var id:E.Identifier = <E.Identifier><any>ast.callee;
          var fn_name = id.name;

          if (fn_name in function_ids) {
            self.replace_node(ast.callee, (<any> to_ast('FN_TABLE[' + fn_name + ".id" + ']')).expression);
          }
        }
      },

      "FunctionDeclaration": function(ast: E.FunctionDeclaration, onlyRecurseOn: (ast:E.Node) => void) {
        onlyRecurseOn(ast);

        // This introduces a block statement, but there isn't really a(n easy) way to get around that...
        self.replace_node(ast,
          to_ast(
            from_ast(ast) + semicolon
            + ast.id.name + ".id = " + function_ids[ast.id.name] + semicolon
            + "FN_TABLE[" + ast.id.name + ".id" + "] = " + ast.id.name
            ));
      }
    });

    return astd.ast();
  }
}

/*
 * Scan script files for updates.
 */
class Scanner {
  scripts: string[] = [];
  loaded_scripts: {[key: string]: string} = {};

  constructor() {
    setInterval(() => this.scan(), 100);
  }

  hotswap(script:string) {
    this.scripts.push(script);
  }

  reload(new_script:string, old_script:string, file_name:string) {
    console.log("reload of " + file_name);

    var i:Instrumentor = new Instrumentor(new_script);

    console.log((<any>escodegen).generate(i.instrument()))

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
  }

  scan() {
    for (var i = 0; i < this.scripts.length; i++) {
      var script_name = this.scripts[i];
      var script = $.ajax({url: script_name, async: false, dataType: 'text', cache: false }).responseText; // Fun fax: if you don't flag it as text, jQuery will "intelligently" assume it to be javascript and recursively eval the same file over and over until the browser crashes.

      if (!this.loaded_scripts[script_name]) {
        this.loaded_scripts[script_name] = script;

        var ins:Instrumentor = new Instrumentor(script)
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
  }
}

if (typeof module === 'undefined') {
  var scanner:Scanner = new Scanner();

  window['hotswap'] = scanner.hotswap.bind(scanner);
}
