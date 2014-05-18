/// <reference path="typings/esprima/esprima.d.ts" />
/// <reference path="typings/jquery/jquery.d.ts" />

declare var module;
declare var escodegen;

import E = esprima.Syntax;

var to_ast = esprima.parse;
var from_ast = escodegen.generate;

/*
Why doesn't this work? :/

declare var escodegen {
  function generate(ast:esprima.Syntax.Program);
};
*/

class ASTDescender {
  callbacks:{[key: string]: (ast:E.Node) => void};
  result:E.Program;

  constructor(ast:E.Program, callbacks:{[key: string]: (ast:E.Node) => void}) {
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

    if (this[dispatch_name]) {
      if (this.callbacks[ast.type]) {
        this.callbacks[ast.type](ast)
      }

      this[dispatch_name](ast);
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
    var function_ids:{[key: string]: number} = this.generate_ids(functions);
    var self:Instrumentor = this;

    // TODO rewrite variable decls e.g var a=5, b=7 to be on separate lines.
    // This is because you can't rewrite var a=function(){} to be var FN_TABLE[...] -
    // you need to remove the var statement, and it would be even more confusing
    // with multiple decls on a single line.

    var astd:ASTDescender = new ASTDescender(ast, {
      "VariableDeclarator" : function(ast: E.VariableDeclarator) {
        if (ast.init.type == "FunctionExpression") {
          ast.id.name = "$" + ast.id.name;
        }
      },

      "FunctionDeclaration": function(ast: E.FunctionDeclaration) {
        self.replace_node(ast, to_ast("FN_TABLE[" + function_ids[ast.id.name] + "] = " + from_ast(ast)));
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
