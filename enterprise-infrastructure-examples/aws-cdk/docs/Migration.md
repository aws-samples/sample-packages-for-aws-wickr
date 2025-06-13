## Migrating to Wickr HA
This document is meant to help guide a migration from Wickr Enterprise legacy to a CDK deployed Wickr Enterprise HA.  

### Assumptions

1. An existing Wickr Enterprise deployment with active users and data. This is referred to as the source.
2. A deployment of Wickr Enterprise HA created via CDK. This is referred to as the target.

### Prerequisites

* AWS credentials for the Command Line Interface https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html
* awscli installed 
* mysql cli client installed 
* nodejs installed 
* kubectl installed
* kotscli installed 
* kots license file
* FQDN with public DNS
* SSL certificate, SSL key, and CA files for your FQDN

### Moving Parts

There are only a few stateful portions of Wickr that must be moved:

1. Wickr Database - The data is obtained by running a mysqldump command from inside the mysql container on the source Messaging host. The dump must then be uploaded to the target RDS database via the bastion.
2. User Uploads - The data is migrated by running a nodejs script on the source Messaging host.
3. Messaging Registration Private Key - The key is obtained by running a docker cp command on the source Messaging host. The key is then uploaded to the KOTS Wickr Enterprise HA web interface.
4. SSL Certificate, SSL Key, and CA Certificate - The SSL certificates used for the FQDN of the source Wickr Enterprise install. These are customer created and managed. The certificates are uploaded to the AWS ACM service using the CDK instructions.
5. DNS for FQDN - The DNS entry for the FQDN for the Wickr Enterprise deployment will need to change to point to the new ALB created by the CDK. DNS is managed by the Customer.
6. Global Federation - The data is obtained by running a docker cp command on the source Messaging host. The identity and key files are then uploaded to the KOTS Wickr Enterprise HA web interface.

### Detailed Steps

Deploy the new infrastructure via the CDK. This will include uploading your certificates to ACM. When the CDK is complete proceed to the source Wickr Enterprise installation.

On the source Wickr Enterprise installation we need to stop the proxy container to stop traffic from getting into the cluster during the migration. Run the following command on the source Messaging server:


```
sudo docker stop proxy
```

With the proxy service stopped we can continue to gather the stateful data that needs to be migrated.

#### Wickr Database

The following command will generate a database dump file which will then be imported to the database on your target environment. Run this command on the source messaging server:

```
sudo docker exec mysql \
  sh -c 'mysqldump -uroot -p$MYSQL_ROOT_PASSWORD --single-transaction --routines wickrdb' \
  | sed 's/\sDEFINER=`[^`]*`@`[^`]*`//g' > ~/wickrdb.sql
```

If this command displays the error Table 'performance_schema.session_variables' doesn't exist (1146) then you need to run the following commands to upgrade the MySQL system tables and restart the MySQL container before attempting to generate the database backup again:

```
wickr mysql-upgrade
sudo docker restart mysql
```
When the database dump has completed, copy the wickrdb.sql file to your local machine. Use the BastionSSMProxyRDSCommand Cloudformation Output found in the WickrEKS Stack to create a port forward to the new RDS database and use the following command to upload the database dump file. Get the database username and password from the RDS secret in Secrets Manager:

```
mysql -u $DATABASE_USER -p$DATABASE_PASSWORD -h 127.0.0.1:3306 wickrdb < wickrdb.sql
```

#### User Uploads

Legacy Wickr Enterprise utilizes a self hosted S3 compatible storage service. Run the following nodejs script from inside the filemanager container on the source Messaging host and it will copy all of the user uploaded files into the new S3 bucket created by the Wickr HA CDK.

```
    const aws = require('aws-sdk');
    
    // Target bucket
    const BUCKET = process.env.AWS_BUCKET_NAME || "";
    const REGION = process.env.AWS_DEFAULT_REGION || "us-east-1";
    
    const sourceConfig = {
    logger: process.stdout,
    httpOptions: undefined,
    apiVersions: {
        s3: '2006-03-01'
    },
    signatureCache: false,
    sslEnabled: false,
    endpoint: '127.0.0.1:8000',
    s3ForcePathStyle: true,
    region: 'wickr-dev-east-2',
    credentials: new aws.Credentials(process.env.ACCESS_KEY_ID, process.env.SECRET_ACCESS_KEY)
    };
    
    const destConfig = {
    logger: process.stdout,
    region: REGION,
    credentials: new aws.Credentials(
        process.env.AWS_ACCESS_KEY_ID,
        process.env.AWS_SECRET_ACCESS_KEY,
        process.env.AWS_SESSION_TOKEN
    )
    };
    
    const scality = new aws.S3(sourceConfig);
    const s3 = new aws.S3(destConfig);
    
    function getListBucketKey() {
    // This is a key which is required to list bucket objects, even when authenticated
    const salt = 'd2VsbCBrbm93biBidXQgb2JzY3VyZQ==';
    return Buffer.from(process.env.ACCESS_KEY_ID + process.env.SECRET_ACCESS_KEY + salt).toString('base64');
    }
    
    function getNextMarker(data) {
    return data.NextMarker || data.Contents[data.Contents.length - 1].Key;
    }
    
    function copyObjects(params) {
    scality.listObjects(params)
        .on('build', req => {
        req.httpRequest.headers['x-wickr-key'] = getListBucketKey();
        })
        .send(async (err, data) => {
        if (err) {
            return console.error(err);
        }
        console.log(`Result length: ${data.Contents.length}`);
        console.log(`More: ${!!data.IsTruncated}`);
        for (const obj of data.Contents) {
            try {
            const data = await scality.getObject({Bucket: 'wickr', Key: obj.Key}).promise();
    
            // upload object to target bucket if it doesn't exist
            try {
                const targetObj = await s3.headObject({Bucket: BUCKET, Key: obj.Key}).promise();
            } catch (e) {
                await s3.putObject({
                Bucket: BUCKET,
                Key: obj.Key,
                Body: data.Body
                }).promise();
            }
    
            } catch (e) {
            console.error(`Error copying object ${obj.Key}: ${e}`);
            }
        }
        if (!!data.IsTruncated) {
            copyObjects({
            ...params,
            Marker: getNextMarker(data)
            });
        }
        });
    }
    
    function fail(msg) {
    console.log(`[FATAL] ${msg}`);
    process.exit(1);
    }
    
    async function testS3Connection() {
    await s3.putObject({Bucket: BUCKET, Key: ".testfile"}).promise();
    }
    
    async function main() {
    if (!BUCKET) fail("Missing AWS_BUCKET_NAME environment variable");
    try {
        await testS3Connection();
    } catch (e) {
        fail(`Failure connecting to S3: ${e}`);
    }
    copyObjects({Bucket: 'wickr'});
    }
    
    main();
```
Copy the script into the filemanager container


```
sudo docker cp s3.js filemanager:/root
```

Exec into the filemanager container


```
sudo docker exec -it filemanager bash
```

You MUST set the following environment variables BEFORE running the S3 script:

* AWS_BUCKET_NAME This is the name of the NEW S3 bucket created by the Wickr HA CDK for the Target account
* AWS_DEFAULT_REGION This is the AWS region that the NEW S3 bucket is in for the Target account
* AWS_ACCESS_KEY_ID This is the AWS CLI Access Key ID for an IAM user on the Target account
* AWS_SECRET_ACCESS_KEY This is the AWS CLI Secret Access Key for an IAM user on the Target account

Run the script to migrate file uploads to S3:

```
node s3.js
```

#### Messaging Registration Private Key

Run the following command on the source Messaging host. This key is then uploaded to the KOTS Wickr Enterprise HA web interface.

```
sudo docker cp server-api:/opt/wickr/certs/reg1-private.pem ~/reg1-private.pem
```

#### Global Federation Key and Identity Chain

Run the following command on the source Messaging host. These files are then uploaded to the KOTS Wickr Enterprise HA web interface.

```
sudo docker cp federation-gateway:/var/lib/wickr/keys/identity_chain ~/identity_chain
sudo docker cp federation-gateway:/var/lib/wickr/keys/pubkey_hash.json ~/pubkey_hash.json
```
### Wickr HA Installation

Once you have migrated the file uploads to S3 and uploaded the database dump to RDS you can complete the Wickr HA installation by opening the KOTS web console where you will enter the Messaging Registration Private Key and Global Federation files if available.
 http://localhost:8800/

Check the Configure Migration Settings box and then upload the Messaging Registration Private Key and Global Federation files.

Continue to Pre-Flight Tests and deploy. You can check the status of the deployment with the following command. Wait for all pods to be in a Running or Completed state.

```
kubectl get pods -n wickr
```
Once all pods are in a Running or Completed state the server-api deployment must be restarted with the following command

```
kubectl rollout restart server-api -n wickr
```

### DNS

Wickr Enterprise HA utilizes CDK to deploy the infrastructure. This CDK also creates an Application Load Balancer (ALB) to allow traffic ingress into the EKS cluster. The existing record for the source Wickr Enterprise FQDN needs to be updated to a CNAME pointing at the ALB from the CDK output. You can get this address from the WickrALB Cloudformation stack Output value AlbDnsName. Once the record is updated and has propagated clients will be able to log back in.
