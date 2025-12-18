import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

const endpoint = process.env.ENDPOINT || "";
const region = process.env.AWS_REGION || "";
const bucket = process.env.S3_BUCKET_NAME || "";
const accessKeyId = process.env.ACCESS_KEY_ID || "";
const secretAccessKey = process.env.SECRET_ACCESS_KEY || "";

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
