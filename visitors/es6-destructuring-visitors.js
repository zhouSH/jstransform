/**
 * Copyright 2004-present Facebook. All Rights Reserved.
 */
/*global exports:true*/

/**
 * Implements ES6 destructuring assignment and pattern matchng.
 *
 * function init({port, ip, coords: [x, y]}) {
 *   return (x && y) ? {id, port} : {ip};
 * };
 *
 * function init($__0) {
 *   var
 *    port = $__0.port,
 *    ip = $__0.ip,
 *    $__1 = $__0.coords,
 *    x = $__1[0],
 *    y = $__1[1];
 *   return (x && y) ? {id, port} : {ip};
 * }
 *
 * var x, {ip, port} = init({ip, port});
 *
 * var x, $__0 = init({ip, port}), ip = $__0.ip, port = $__0.port;
 *
 */
var Syntax = require('esprima-fb').Syntax;
var utils = require('../src/utils');

var restParamVisitors = require('./es6-rest-param-visitors');

// -------------------------------------------------------
// 1. Structured variable declarations.
//
// var [a, b] = [b, a];
// var {x, y} = {y, x};
// -------------------------------------------------------

function visitStructuredVariable(traverse, node, path, state) {
  // Allocate new temp for the pattern.
  utils.append(getTmpVar(0) + '=', state);
  // Skip the pattern and assign the init to the temp.
  utils.catchupWhiteSpace(node.init.range[0], state);
  traverse(node.init, path, state);
  utils.catchup(node.init.range[1], state);
  // Render the destructured data.
  utils.append(',' + getDestructuredComponents(node.id, 0), state);
  return false;
}

visitStructuredVariable.test = function(node, path, state) {
  return node.type === Syntax.VariableDeclarator &&
    isStructuredPattern(node.id);
};

function isStructuredPattern(node) {
  return node.type === Syntax.ObjectPattern ||
    node.type === Syntax.ArrayPattern;
}

// Main function which does actual recursive destructuring
// of nested complex structures.
function getDestructuredComponents(node, tmpIndex) {
  var components = [];
  var patternItems = getPatternItems(node);

  for (var idx = 0; idx < patternItems.length; idx++) {
    var item = patternItems[idx];
    if (!item) {
      continue;
    }

    // Depending on pattern type (Array or Object), we get
    // corresponding pattern item parts.
    var accessor = getPatternItemAccessor(node, item, tmpIndex, idx);
    var value = getPatternItemValue(node, item);

    // TODO(dmitrys): implement spread array elements: [a, b, ...r].
    // TODO(dmitrys): implement default values: {x, y=5}
    if (value.type === Syntax.Identifier) {
      // Simple pattern item.
      components.push(value.name + '=' + accessor);
    } else {
      // Complex sub-structure.
      components.push(getInitialValue(tmpIndex + 1, accessor) + ',' +
        getDestructuredComponents(value, tmpIndex + 1));
    }
  }

  return components.join(',');
}

function getPatternItems(node) {
  return node.properties || node.elements;
}

function getPatternItemAccessor(node, patternItem, tmpIndex, idx) {
  var tmpName = getTmpVar(tmpIndex);
  return node.type === Syntax.ObjectPattern
    ? tmpName + '.' + patternItem.key.name
    : tmpName + '[' + idx + ']';
}

function getPatternItemValue(node, patternItem) {
  return node.type === Syntax.ObjectPattern
    ? patternItem.value
    : patternItem;
}

function getInitialValue(index, value) {
  return getTmpVar(index) + '=' + value;
}

function getTmpVar(index) {
  return '$__' + index;
}

// -------------------------------------------------------
// 2. Assignment expression.
//
// [a, b] = [b, a];
// ({x, y} = {y, x});
// -------------------------------------------------------

function visitStructuredAssignment(traverse, node, path, state) {
  var exprNode = node.expression;
  utils.append('var ' + getTmpVar(0) + '=', state);
  utils.catchupWhiteSpace(exprNode.right.range[0], state);
  traverse(exprNode.right, path, state);
  utils.catchup(exprNode.right.range[1], state);
  utils.append(',' + getDestructuredComponents(exprNode.left, 0) + ';', state);
  utils.catchupWhiteSpace(node.range[1], state);
  return false;
}

visitStructuredAssignment.test = function(node, path, state) {
  // We consider the expression statement rather than just assignment
  // expression to cover case with object patters which should be
  // wrapped in grouping operator: ({x, y} = {y, x});
  return node.type === Syntax.ExpressionStatement &&
    node.expression.type === Syntax.AssignmentExpression &&
    isStructuredPattern(node.expression.left);
};

// -------------------------------------------------------
// 3. Structured parameter.
//
// function foo({x, y}) { ... }
// -------------------------------------------------------

// Temp variable allocation index used in params list.
var paramAllocationIndex = -1;

function visitStructuredParameter(traverse, node, path, state) {
  utils.append(getTmpVar(++paramAllocationIndex), state);
  utils.catchupWhiteSpace(node.range[1], state);
  return true;
}

visitStructuredParameter.test = function(node, path, state) {
  return isStructuredPattern(node) && isFunctionNode(path[0]);
};

function isFunctionNode(node) {
  return (node.type == Syntax.FunctionDeclaration ||
    node.type == Syntax.FunctionExpression ||
    node.type == Syntax.MethodDefinition ||
    node.type == Syntax.ArrowFunctionExpression);
}

// -------------------------------------------------------
// 4. Function body for structured parameters.
//
// function foo({x, y}) { x; y; }
// -------------------------------------------------------

function visitFunctionBodyForStructuredParameter(traverse, node, path, state) {
  var funcNode = path[0];

  utils.catchup(funcNode.body.range[0] + 1, state);
  renderDestructuredComponents(funcNode, state);

  if (funcNode.rest) {
    utils.append(
      restParamVisitors.renderRestParamSetup(funcNode),
      state
    );
  }

  return true;
}

// Temp variable allocation index used in function bodies.
var funcBodyAllocationIndex = -1;

function renderDestructuredComponents(funcNode, state) {
  var destructuredComponents = [];

  for (var k = 0; k < funcNode.params.length; k++) {
    var param = funcNode.params[k];
    if (isStructuredPattern(param)) {
      destructuredComponents.push(
        getDestructuredComponents(param, ++funcBodyAllocationIndex)
      );
    }
  }

  if (destructuredComponents.length) {
    utils.append('var ' + destructuredComponents.join(',') + ';', state);
  }
}

visitFunctionBodyForStructuredParameter.test = function(node, path, state) {
  return node.type === Syntax.BlockStatement && isFunctionNode(path[0]);
};

exports.visitorList = [
  visitStructuredVariable,
  visitStructuredAssignment,
  visitStructuredParameter,
  visitFunctionBodyForStructuredParameter
];

exports.renderDestructuredComponents = renderDestructuredComponents;

