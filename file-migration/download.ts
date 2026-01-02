import { mkdir } from 'fs/promises';
import * as fs from 'fs';
import { S3Client, ListBucketsCommand, ListObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// Target bucket
const bucket = process.env.S3_BUCKET_NAME || "wickr";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const sourceEndpoint = process.env.S3_ENDPOINT || "127.0.0.1:4569";
const downloadDir = process.env.DOWNLOAD_DIR || "./downloads";
const accessKey = process.env.ACCESS_KEY_ID;
const secretKey = process.env.SECRET_ACCESS_KEY;

const sourceConfig = {
  region,
  endpoint: {
    protocol: 'http:',
    hostname: sourceEndpoint.split(':')[0],
    port: sourceEndpoint.split(':')[1] || 4569,
    path: '/'
  },
  forcePathStyle: true,
  tls: false,
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey
  }
};

const scality = new S3Client(sourceConfig);

async function createDirectory(directory: String) {
  try {
    await mkdir(directory, { recursive: true });
    console.log(`Using ${directory} as storage location`);
  } catch (err) {
    console.error(`Error creating directory ${directory}: ${err.message}`);
  }
}

function getListBucketKey() {
  const salt = 'd2VsbCBrbm93biBidXQgb2JzY3VyZQ==';
  return Buffer.from(accessKey + secretKey! + salt).toString('base64');
}

function getNextMarker(data) {
  return data.NextMarker || data.Contents[data.Contents.length - 1].Key;
}

async function copyObjects(params) {
  try {
    const command = new ListObjectsCommand(params);
    command.middlewareStack.add(
      (next) => async (args) => {
        args.request.headers['x-wickr-key'] = getListBucketKey();
        return next(args);
      },
      { step: 'build' }
    );

    const data = await scality.send(command);

    for (const obj of data.Contents!) {
      try {
        const getCommand = new GetObjectCommand({Bucket: bucket, Key: obj.Key});
        const objData = await scality.send(getCommand);

        const destinationPath = `${downloadDir}/${obj.Key}`;
        console.log(`Writing ${obj.Key} to ${destinationPath}`);
        const writeFile = fs.createWriteStream(destinationPath);
        objData.Body.pipe(writeFile);

        await new Promise((resolve, reject) => {
          writeFile.on("finish", () => resolve("Download complete"));
          writeFile.on("error", reject);
        });
      } catch (e) {
        console.error(`Error copying object ${obj.Key}: ${e}`);
      }
    }

    if (!!data.IsTruncated) {
      await copyObjects({
        ...params,
        Marker: getNextMarker(data)
      });
    }
  } catch (err) {
    console.error(err);
  }
}

function fail(msg) {
  console.log(`[FATAL] ${msg}`);
  process.exit(1);
}

async function testS3Connection() {
  await scality.send(new ListBucketsCommand({}))
}

async function main() {
  if (!accessKey) fail("Missing ACCESS_KEY_ID environment variable");
  if (!secretKey) fail("Missing SECRET_ACCESS_KEY environment variable");
  try {
    await testS3Connection();
  } catch (e) {
    fail(`Failure connecting to S3: ${e}`);
  }
  createDirectory(downloadDir)
  await copyObjects({Bucket: bucket});
}

main();
