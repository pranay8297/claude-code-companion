#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PACKAGE_JSON = path.join(ROOT, "package.json");
const FORBIDDEN_DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
  "bundleDependencies"
];
const FORBIDDEN_LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "prepack",
  "postpack"
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && fullPath.endsWith(".mjs")) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractBareImports(source) {
  const matches = [];
  const patterns = [
    /\bimport\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier.startsWith("node:") && !specifier.startsWith("./") && !specifier.startsWith("../")) {
        matches.push(specifier);
      }
    }
  }
  return matches;
}

const pkg = readPackageJson();

for (const field of FORBIDDEN_DEP_FIELDS) {
  if (pkg[field] && Object.keys(pkg[field]).length > 0) {
    fail(`Forbidden dependency field is populated: ${field}`);
  }
}

for (const scriptName of FORBIDDEN_LIFECYCLE_SCRIPTS) {
  if (pkg.scripts?.[scriptName]) {
    fail(`Forbidden npm lifecycle script present: ${scriptName}`);
  }
}

for (const file of walk(path.join(ROOT, "scripts"))) {
  const bareImports = extractBareImports(fs.readFileSync(file, "utf8"));
  if (bareImports.length > 0) {
    fail(`${path.relative(ROOT, file)} imports external package(s): ${bareImports.join(", ")}`);
  }
}

if (!process.exitCode) {
  process.stdout.write("Supply-chain check passed: no npm dependencies, no install lifecycle scripts, no external package imports.\n");
}
