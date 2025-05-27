import * as path from 'path';

import { runTests, runVSCodeCommand } from '@vscode/test-electron';

// VS Code 1.100.* has a problem with verification of Roo-Code extension during installation.
//
// VS Code 1.100 by default enabled extension signature verification:
//  <https://code.visualstudio.com/updates/v1_100#_mandatory-extension-signature-verification>
//
// Set to `undefined` when the problem is resolved to use the latest stable version.
const VSCODE_VERSION = '1.99.0';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    const version = process.env.ROOCODE_VERSION;

    await runVSCodeCommand(
      ['--install-extension', `RooVeterinaryInc.roo-cline@${version}`],
      { version: VSCODE_VERSION },
    );
    // Download VS Code, unzip it and run the integration test
    await runTests(
      { extensionDevelopmentPath, extensionTestsPath, version: VSCODE_VERSION }
    );
  } catch (err) {
    console.error(err);
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
