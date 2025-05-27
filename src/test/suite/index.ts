import * as path from 'path';
import Mocha from 'mocha';

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { compareVersions } from 'compare-versions';

chai.use(chaiAsPromised);

// Versions must be sorted in ascending order.
const TEST_BASE_VERSIONS = ['3.14.0', '3.15.4', '3.17.0', '3.17.2'];

export function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 100000,
    slow: 10000,
  });

  const testsRoot = path.resolve(__dirname, '..');

  const version = process.env.ROOCODE_VERSION;
  if (!version) {
    throw new Error('ROOCODE_VERSION is not set');
  }

  return new Promise((c, e) => {  
    try {
      const testFileVersion = getTestFileVersion(version);
      mocha.addFile(path.resolve(testsRoot, `controller-${testFileVersion}.test.js`));

      // Run the mocha test
      mocha.run(failures => {
        if (failures > 0) {
          e(new Error(`${failures} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      e(err);
    }
  });
}

function getTestFileVersion(version: string): string {
  for (const minVer of TEST_BASE_VERSIONS.slice().reverse()) {
    if (compareVersions(version, minVer) >= 0) {
      return minVer;
    }
  }
  throw new Error('Unsupported RooCode version: ' + version);
}
