export function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!raw.startsWith("-") || raw === "-") {
      positionals.push(raw);
      continue;
    }

    const withoutPrefix = raw.replace(/^-+/, "");
    const equalsIndex = withoutPrefix.indexOf("=");
    const keyRaw = equalsIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, equalsIndex);
    const key = aliasMap[keyRaw] ?? keyRaw;
    const inlineValue = equalsIndex === -1 ? null : withoutPrefix.slice(equalsIndex + 1);

    if (booleanOptions.has(key)) {
      options[key] = inlineValue == null ? true : inlineValue !== "false";
      continue;
    }

    if (valueOptions.has(key)) {
      if (inlineValue != null) {
        options[key] = inlineValue;
        continue;
      }
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for --${key}.`);
      }
      options[key] = argv[index];
      continue;
    }

    if (inlineValue != null) {
      options[key] = inlineValue;
    } else {
      options[key] = true;
    }
  }

  return { options, positionals };
}

export function stringArg(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
