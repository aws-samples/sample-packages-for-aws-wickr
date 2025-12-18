import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

const endpoint = process.env.HA_ENDPOINT || "";
const region = process.env.HA_AWS_REGION || "";
const bucket = process.env.HA_BUCKET_NAME || "";
const accessKeyId = process.env.HA_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.HA_SECRET_ACCESS_KEY || "";

const s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    tls: false,
    credentials: {
        accessKeyId,
        secretAccessKey,
    },
});

async function listS3Buckets() {
    const command = new ListBucketsCommand({});

    const data = await s3Client.send(command);

    console.log("Success", data.Buckets);
}

listS3Buckets();
