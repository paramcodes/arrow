/**
 * Local ESLint rules for Arrow.
 *
 * These are the checks ESLint core cannot express: a JSON payload must reach
 * a schema before it is trusted, a test may not be skipped or focused, no file
 * may carry its own lint configuration, and no import may reach across a
 * layer boundary.
 */

import path from "node:path";

const SCHEMA_PARSE_METHODS = new Set(["parse", "safeParse", "parseAsync", "safeParseAsync"]);

const TEST_CALL_NAMES = new Set(["it", "test", "describe", "suite", "bench"]);

const DISABLED_TEST_CALLS = new Set(["xit", "xtest", "xdescribe", "xbench"]);

const DISABLED_TEST_METHODS = new Set(["skip", "only", "todo"]);

function isJsonParseCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "JSON" &&
    node.callee.property.name === "parse"
  );
}

function isSchemaParseCall(node) {
  if (!node || node.type !== "CallExpression") return false;
  if (node.callee.type !== "MemberExpression" || node.callee.computed) return false;
  return SCHEMA_PARSE_METHODS.has(node.callee.property.name);
}

function rootCalleeName(node) {
  let current = node;
  while (current.type === "MemberExpression" || current.type === "CallExpression") {
    current = current.type === "MemberExpression" ? current.object : current.callee;
  }
  return current.type === "Identifier" ? current.name : null;
}

const noRawJsonParse = {
  meta: {
    type: "problem",
    docs: {
      description: "Require untrusted JSON to be parsed through a schema before use.",
    },
    schema: [],
    messages: {
      rawJsonParse:
        "Parse this JSON through a schema. Hand the result to a schema parse call instead of using it raw.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isJsonParseCall(node)) return;
        if (isSchemaParseCall(node.parent)) return;
        context.report({ node, messageId: "rawJsonParse" });
      },
    };
  },
};

const noSkippedTests = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow skipped, focused and todo tests.",
    },
    schema: [],
    messages: {
      skippedTest:
        "This test is skipped, focused or unfinished. Finish it and delete the marker before committing.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier") {
          if (DISABLED_TEST_CALLS.has(node.callee.name)) {
            context.report({ node, messageId: "skippedTest" });
          }
          return;
        }

        if (node.callee.type !== "MemberExpression" || node.callee.computed) return;
        if (!DISABLED_TEST_METHODS.has(node.callee.property.name)) return;

        const root = rootCalleeName(node.callee);
        if (root && TEST_CALL_NAMES.has(root)) {
          context.report({ node, messageId: "skippedTest" });
        }
      },
    };
  },
};

const noInlineConfig = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow inline ESLint configuration.",
    },
    schema: [],
    messages: {
      inlineConfig:
        "Inline ESLint configuration is not allowed. Fix the code or change the shared rule in eslint.config.mjs.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program() {
        const directives =
          typeof sourceCode.getInlineConfigNodes === "function"
            ? sourceCode.getInlineConfigNodes()
            : sourceCode.getAllComments().filter((comment) => /^\s*eslint\b/.test(comment.value));

        for (const comment of directives) {
          context.report({ node: comment, messageId: "inlineConfig" });
        }
      },
    };
  },
};

const noCrossLayerImport = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow imports that reach across a layer boundary.",
    },
    schema: [
      {
        type: "object",
        properties: {
          forbiddenPackages: { type: "array", items: { type: "string" } },
          forbiddenRoots: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      crossLayer: "This import crosses a layer boundary. {{detail}}",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const forbiddenPackages = options.forbiddenPackages ?? [];
    const forbiddenRoots = options.forbiddenRoots ?? [];
    const cwd = context.cwd ?? process.cwd();
    const filename = context.filename;

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;

        const forbidden = forbiddenPackages.find(
          (name) => source === name || source.startsWith(`${name}/`),
        );
        if (forbidden) {
          context.report({
            node,
            messageId: "crossLayer",
            data: {
              detail: `${source} is not available in this layer.`,
            },
          });
          return;
        }

        if (!source.startsWith(".")) return;

        const resolved = path.resolve(path.dirname(filename), source);
        for (const root of forbiddenRoots) {
          const rootPath = path.resolve(cwd, root);
          if (resolved === rootPath || resolved.startsWith(`${rootPath}${path.sep}`)) {
            context.report({
              node,
              messageId: "crossLayer",
              data: {
                detail: `${source} reaches into ${root}, which this layer may not import.`,
              },
            });
            return;
          }
        }
      },
    };
  },
};

export const rules = {
  "no-raw-json-parse": noRawJsonParse,
  "no-skipped-tests": noSkippedTests,
  "no-inline-config": noInlineConfig,
  "no-cross-layer-import": noCrossLayerImport,
};

/**
 * The plugin object. Both the shared config and the architecture config import
 * this one instance, because ESLint refuses a plugin that is defined twice.
 */
export const plugin = { rules };
