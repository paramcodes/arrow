/**
 * Local ESLint rules for Arrow.
 *
 * These are the checks ESLint core cannot express: a JSON payload must reach
 * a schema before it is trusted, a test may not be skipped or focused, no file
 * may carry its own lint configuration, no import may reach across a layer
 * boundary, no secret may reach the webview, and one file may not mix two
 * state tiers.
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

/**
 * Reports an import source that crosses a layer boundary. The same check runs
 * for every form an import can take: a static import, a dynamic import and a
 * CommonJS require. A rule that only reads the static form can be bypassed
 * with `await import("...")`, so all three forms go through one path.
 */
function reportCrossLayerImport(context, node, source, options) {
  const { forbiddenPackages, forbiddenRoots, cwd, filename } = options;

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
}

/**
 * The source of an import, when it can be resolved without running the code.
 * A string literal and a template without a hole in it are resolved. A
 * variable, or a template that interpolates, is not: the source is only known
 * at run time, so no boundary can be checked against it.
 */
function staticSource(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  return null;
}

/**
 * Names the source of an import that cannot be resolved, so the message says
 * what the rule could not check.
 */
function describeSource(node) {
  if (!node) return "nothing";
  if (node.type === "Identifier") return `the variable ${node.name}`;
  if (node.type === "TemplateLiteral") {
    return `a template with ${node.expressions.length} expression in it`;
  }
  return node.type;
}

const UNRESOLVED_SOURCE =
  "The source of this import is not known until the code runs, so the boundary cannot be checked. Use a string literal so the rule can read it.";

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
    const settings = {
      forbiddenPackages: options.forbiddenPackages ?? [],
      forbiddenRoots: options.forbiddenRoots ?? [],
      cwd: context.cwd ?? process.cwd(),
      filename: context.filename,
    };

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        reportCrossLayerImport(context, node, source, settings);
      },

      ImportExpression(node) {
        const source = staticSource(node.source);
        if (source === null) {
          context.report({
            node,
            messageId: "crossLayer",
            data: {
              detail: `${describeSource(node.source)} is not a known source. ${UNRESOLVED_SOURCE}`,
            },
          });
          return;
        }
        reportCrossLayerImport(context, node, source, settings);
      },

      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
        const argument = node.arguments[0];
        if (!argument) return;
        const source = staticSource(argument);
        if (source === null) {
          context.report({
            node,
            messageId: "crossLayer",
            data: {
              detail: `${describeSource(argument)} is not a known source. ${UNRESOLVED_SOURCE}`,
            },
          });
          return;
        }
        reportCrossLayerImport(context, node, source, settings);
      },
    };
  },
};

/**
 * The names that carry key material. A name that matches one of them is a
 * secret on its way to the DOM, the bundle, the logs or a frontend store.
 */
const SECRET_NAME =
  /(api[-_]?key|secret|password|passphrase|credential|private[-_]?key|access[-_]?token|auth[-_]?token|refresh[-_]?token|bearer)/i;

const STORAGE_WRITERS = new Set(["localStorage", "sessionStorage"]);

const LOG_METHODS = new Set(["log", "info", "warn", "error", "debug", "trace"]);

function namesSecret(text) {
  return typeof text === "string" && SECRET_NAME.test(text);
}

/**
 * True when the value carries the name of a secret. A string literal is read
 * by its content, an identifier by its name.
 */
function carriesSecret(node) {
  if (!node) return false;
  if (node.type === "Literal") return namesSecret(node.value);
  if (node.type === "Identifier") return namesSecret(node.name);
  if (node.type === "TemplateLiteral") {
    return node.quasis.some((quasi) => namesSecret(quasi.value.raw));
  }
  return false;
}

const noSecretInWebview = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow key material in the webview, the DOM, the logs and frontend stores.",
    },
    schema: [],
    messages: {
      secretEnvironment:
        "This reads key material from the environment. A key belongs in Rust and the OS keychain, never in the webview bundle.",
      secretStorage:
        "This writes key material to browser storage. A key belongs in Rust and the OS keychain, never in the webview.",
      secretLog:
        "This logs key material. A key belongs in Rust and the OS keychain, never in the webview logs.",
      secretCookie:
        "This writes key material to a cookie. A key belongs in Rust and the OS keychain, never in the webview.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        // import.meta.env.SOMETHING
        const object = node.object;
        if (object.type !== "MemberExpression" || object.computed) return;
        if (object.object.type !== "MetaProperty") return;
        if (object.property.type !== "Identifier" || object.property.name !== "env") return;

        const name = node.computed
          ? node.property.type === "Literal"
            ? node.property.value
            : ""
          : node.property.name;
        if (!namesSecret(name)) return;

        context.report({ node, messageId: "secretEnvironment" });
      },

      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.object.type !== "Identifier") return;

        if (
          STORAGE_WRITERS.has(callee.object.name) &&
          callee.property.type === "Identifier" &&
          callee.property.name === "setItem"
        ) {
          if (node.arguments.some((argument) => carriesSecret(argument))) {
            context.report({ node, messageId: "secretStorage" });
          }
          return;
        }

        if (
          callee.object.name === "console" &&
          callee.property.type === "Identifier" &&
          LOG_METHODS.has(callee.property.name)
        ) {
          if (node.arguments.some((argument) => carriesSecret(argument))) {
            context.report({ node, messageId: "secretLog" });
          }
        }
      },

      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== "MemberExpression" || left.computed) return;
        if (left.object.type !== "Identifier" || left.object.name !== "document") return;
        if (left.property.type !== "Identifier" || left.property.name !== "cookie") return;
        if (!carriesSecret(node.right)) return;
        context.report({ node, messageId: "secretCookie" });
      },
    };
  },
};

/**
 * The state tier every library owns. Zustand holds workspace facts, Jotai
 * holds per-item facts and XState holds async workflows. One file may not
 * reach across two of them.
 */
const STATE_TIERS = new Map([
  ["zustand", "Zustand"],
  ["zustand/vanilla", "Zustand"],
  ["jotai", "Jotai"],
  ["jotai/utils", "Jotai"],
  ["xstate", "XState"],
  ["@xstate/react", "XState"],
]);

const noCrossTierStore = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow one file from importing two state tiers.",
    },
    schema: [],
    messages: {
      crossTier:
        "This file reaches the {{tier}} tier, and it already owns the {{other}} tier. One tier per file: Zustand for workspace facts, Jotai for per-item facts, XState for async workflows.",
      crossTierUnknown:
        "The source of this import is not known until the code runs, so the tier boundary cannot be checked. Use a string literal so the rule can read it.",
    },
  },
  create(context) {
    const owned = new Set();

    function check(node, source) {
      if (typeof source !== "string") return;
      const tier = STATE_TIERS.get(source);
      if (!tier) return;
      if (owned.has(tier)) return;

      for (const other of owned) {
        context.report({
          node,
          messageId: "crossTier",
          data: { tier, other },
        });
        return;
      }

      owned.add(tier);
    }

    /**
     * The source of an import that cannot be resolved. The tier of such an
     * import is unknown, and an unknown tier cannot be checked, so the rule
     * refuses it instead of letting it through.
     */
    function checkUnknown(node) {
      context.report({ node, messageId: "crossTierUnknown" });
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        const source = staticSource(node.source);
        if (source === null) {
          checkUnknown(node);
          return;
        }
        check(node, source);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
        const argument = node.arguments[0];
        if (!argument) return;
        const source = staticSource(argument);
        if (source === null) {
          checkUnknown(node);
          return;
        }
        check(node, source);
      },
    };
  },
};

export const rules = {
  "no-raw-json-parse": noRawJsonParse,
  "no-skipped-tests": noSkippedTests,
  "no-inline-config": noInlineConfig,
  "no-cross-layer-import": noCrossLayerImport,
  "no-secret-in-webview": noSecretInWebview,
  "no-cross-tier-store": noCrossTierStore,
};

/**
 * The plugin object. Both the shared config and the architecture config import
 * this one instance, because ESLint refuses a plugin that is defined twice.
 */
export const plugin = { rules };
