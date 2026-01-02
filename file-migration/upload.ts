import { readdir, stat } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// Target bucket
const bucket = process.env.HA_BUCKET_NAME || "wickr";
const region = process.env.HA_AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const destEndpoint = process.env.HA_ENDPOINT || "127.0.0.1:9000";
const downloadDir = process.env.DOWNLOAD_DIR || "./downloads";
const accessKey = process.env.HA_ACCESS_KEY_ID;
const secretKey = process.env.HA_SECRET_ACCESS_KEY;

const sourceConfig = {
  region,
  endpoint: {
    protocol: 'http:',
    hostname: destEndpoint.split(':')[0],
    port: destEndpoint.split(':')[1] || 9000,
    path: '/'
  },
  forcePathStyle: true,
  tls: false,
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey
  }
};

const s3 = new S3Client(sourceConfig);

function getListBucketKey() {
  const salt = 'd2VsbCBrbm93biBidXQgb2JzY3VyZQ==';
  return Buffer.from(accessKey! + secretKey + salt).toString('base64');
}

async function getAllFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const files: string[] = [];
  const items = await readdir(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      files.push(...await getAllFiles(fullPath, baseDir));
    } else {
      files.push(path.relative(baseDir, fullPath));
    }
  }

  return files;
}

async function uploadFiles() {
  try {
    const files = await getAllFiles(downloadDir);

    for (const file of files) {
      try {
        const filePath = path.join(downloadDir, file);
        const key = file.replace(/\\/g, '/'); // Normalize path separators for S3

        // Check if object already exists
        try {
          await s3.send(new HeadObjectCommand({Bucket: bucket, Key: key}));
          console.log(`Skipping ${key} - already exists`);
          continue;
        } catch (e) {
          // Object doesn't exist, proceed with upload
        }

        console.log(`Uploading ${file} to ${key}`);
        const fileStream = fs.createReadStream(filePath);

        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fileStream
        });

        command.middlewareStack.add(
          (next) => async (args) => {
            args.request.headers['x-wickr-key'] = getListBucketKey();
            return next(args);
          },
          { step: 'build' }
        );

        await s3.send(command);
        console.log(`Successfully uploaded ${key}`);

      } catch (e) {
        console.error(`Error uploading file ${file}: ${e}`);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${downloadDir}: ${err}`);
  }
}

function fail(msg: string) {
  console.log(`[FATAL] ${msg}`);
  process.exit(1);
}

async function testS3Connection() {
  console.log(`Testing connection to ${destEndpoint}`)
  await s3.send(new PutObjectCommand({Bucket: bucket, Key: ".testfile"}));
}

async function main() {
  if (!accessKey) fail("Missing ACCESS_KEY_ID environment variable");
  if (!secretKey) fail("Missing SECRET_ACCESS_KEY environment variable");

  try {
    await testS3Connection();
  } catch (e) {
    fail(`Failure connecting to S3: ${e}`);
  }

  await uploadFiles();
}

main();
