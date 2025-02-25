const https = require('https');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);
const tar = require('tar');
const { execSync } = require('child_process');

const PYODIDE_VERSION = '0.23.4';
const PYODIDE_URL = `https://github.com/pyodide/pyodide/releases/download/${PYODIDE_VERSION}/pyodide-core-${PYODIDE_VERSION}.tar.bz2`;
const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'pyodide');
const TEMP_ARCHIVE_BZ2 = path.join(RESOURCES_DIR, 'pyodide.tar.bz2');
const TEMP_ARCHIVE_TAR = path.join(RESOURCES_DIR, 'pyodide.tar');

async function downloadFile(url, destPath) {
    console.log(`Downloading ${url} to ${destPath}`);
    
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: {
                'Accept': 'application/octet-stream',
                'User-Agent': 'Node.js'
            },
            followRedirects: true
        }, (response) => {
            // Handle redirects manually since Node.js doesn't do it by default
            if (response.statusCode === 302 || response.statusCode === 301) {
                const redirectUrl = response.headers.location;
                console.log(`Following redirect to ${redirectUrl}`);
                // Abort the current request
                request.destroy();
                // Start a new request with the redirect URL
                https.get(redirectUrl, (redirectResponse) => {
                    if (redirectResponse.statusCode !== 200) {
                        reject(new Error(`Failed to download from redirect ${redirectUrl}: ${redirectResponse.statusCode}`));
                        return;
                    }
                    const fileStream = fs.createWriteStream(destPath);
                    pipeline(redirectResponse, fileStream)
                        .then(() => resolve())
                        .catch(reject);
                }).on('error', reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                return;
            }

            const fileStream = fs.createWriteStream(destPath);
            pipeline(response, fileStream)
                .then(() => resolve())
                .catch(reject);
        }).on('error', reject);
    });
}

async function decompressBz2(bz2Path, tarPath) {
    console.log(`Decompressing ${bz2Path} to ${tarPath}`);
    execSync(`bzip2 -dc "${bz2Path}" > "${tarPath}"`);
}

async function extractArchive(archivePath, destDir) {
    console.log(`Extracting ${archivePath} to ${destDir}`);
    await tar.x({
        file: archivePath,
        cwd: destDir,
        strip: 1 // Remove the top-level directory from the archive
    });
}

async function main() {
    try {
        // Create resources directory if it doesn't exist
        if (!fs.existsSync(RESOURCES_DIR)) {
            fs.mkdirSync(RESOURCES_DIR, { recursive: true });
        }

        // Download the archive
        await downloadFile(PYODIDE_URL, TEMP_ARCHIVE_BZ2);
        console.log('Successfully downloaded Pyodide archive');

        // Decompress bz2 to tar
        await decompressBz2(TEMP_ARCHIVE_BZ2, TEMP_ARCHIVE_TAR);
        console.log('Successfully decompressed bz2 archive');

        // Extract the tar archive
        await extractArchive(TEMP_ARCHIVE_TAR, RESOURCES_DIR);
        console.log('Successfully extracted Pyodide files');

        // Clean up temporary files
        fs.unlinkSync(TEMP_ARCHIVE_BZ2);
        fs.unlinkSync(TEMP_ARCHIVE_TAR);
        console.log('Cleaned up temporary files');

    } catch (error) {
        console.error('Error:', error);
        // Clean up temporary files in case of error
        if (fs.existsSync(TEMP_ARCHIVE_BZ2)) {
            fs.unlinkSync(TEMP_ARCHIVE_BZ2);
        }
        if (fs.existsSync(TEMP_ARCHIVE_TAR)) {
            fs.unlinkSync(TEMP_ARCHIVE_TAR);
        }
        process.exit(1);
    }
}

main().catch(console.error);