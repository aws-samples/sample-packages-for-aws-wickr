# Wickr Enterprise CDK Deployment

This sample [Amazon CDK](https://aws.amazon.com/cdk/) package provides basic AWS Infrastructure needed for running Wickr Enterprise in AWS. This package should be used as a reference and modified to fit specific environments and use cases.

## Getting Started

### Requirements

- Node.js 16+
- AWS CLI configured with credentials for your account
  - These will be sourced either from your config file at `~/.aws/config` or using the `AWS_` environment variables
- [kubectl](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)
- [kots](https://docs.replicated.com/reference/kots-cli-getting-started)

### Install dependencies

```
npm install
```

### Configure

CDK uses [context values](https://docs.aws.amazon.com/cdk/v2/guide/context.html) to control configuration of the application. Wickr Enterprise uses CDK context values to provide control over settings such as the domain name of your Wickr Enterprise installation or the number of days to retain RDS backups.

There are [multiple ways to set context values](https://docs.aws.amazon.com/cdk/v2/guide/context.html#context_construct), but we recommend editing the values in `cdk.context.json` to fit your particular use case. Only context values which begin with `wickr/` are related to the Wickr Enterprise deployment; the rest are CDK-specific context values. Save this file so that the next time you need to make an update via CDK you will have the same settings.

At a minimum, you must set `wickr/licensePath`, `wickr/domainName`, and either `wickr/acm:certificateArn` or `wickr/route53:hostedZoneId` and `wickr/route53:hostedZoneName`.

#### With a Public Hosted Zone

If you have a Route53 Public Hosted Zone in your AWS account, we recommend using the following settings for configuring your CDK context:

 - `wickr/domainName` - The domain name to use for this Wickr Enterprise deployment. If using a Route53 Public Hosted Zone, DNS records and ACM certificates for this domain name will be automatically created.
 - `wickr/route53:hostedZoneName` - Route53 Hosted Zone Name in which to create DNS records
 - `wickr/route53:hostedZoneId` - Route53 Hosted Zone ID in which to create DNS records

This method will create an ACM certificate on your behalf, as well as the DNS records pointing your domain name to the load balancer in front of your Wickr Enterprise deployment.

#### Without a Public Hosted Zone

If you do not have a Route53 Public Hosted Zone in your account, an ACM certificate will need to be created manually and imported into CDK using the `wickr/acm:certificateArn` context value.

 - `wickr/domainName` - The domain name to use for this Wickr Enterprise deployment. If using a Route53 Public Hosted Zone, DNS records and ACM certificates for this domain name will be automatically created.
 - `wickr/acm:certificateArn` -  ARN of an ACM certificate to use on the Load Balancer. This value must be supplied if a Route53 Public Hosted Zone is not available in your account.

##### Importing a certificate to ACM

You can import an externally obtained certificate with the following command:

```
aws acm import-certificate \
  --certificate fileb://path/to/cert.pem \
  --private-key fileb://path/to/key.pem \
  --certificate-chain fileb://path/to/chain.pem
```

The output will be the Certificate ARN which should be used for the value of the `wickr/acm:certificateArn` context setting. It is important that the uploaded certificate is valid for the `wickr/domainName`, or HTTPS connections will be unable to validate.

See the [Importing a certificate](https://docs.aws.amazon.com/acm/latest/userguide/import-certificate-api-cli.html) documentation from the AWS docs for full details.

##### Creating DNS records

Since there is no Public Hosted Zone available, DNS records will need to be created manually after the deployment is finished to point to the load balancer in front of your Wickr Enterprise deployment.

#### Deploying into an existing VPC

If you require the use of an existing VPC you can use one. However, the VPC must be configured to meet the specifications necessary for EKS. Please review
[View Amazon EKS networking requirements for VPC and subnets](https://docs.aws.amazon.com/eks/latest/userguide/network-reqs.html) and ensure the VPC to be used meets these requirements.

Additionally, it is highly recommended to ensure you have [VPC Endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)
for the following services:
  - CLOUDWATCH
  - CLOUDWATCH_LOGS
  - EC2
  - EC2_MESSAGES
  - ECR
  - ECR_DOCKER
  - ELASTIC_LOAD_BALANCING
  - KMS
  - SECRETS_MANAGER
  - SSM
  - SSM_MESSAGES

To deploy resources into an existing VPC, set the following context values:

- `wickr/vpc:id` - The VPC ID to deploy resources into (e.g. `vpc-412beef`)
- `wickr/vpc:cidr` - The IPv4 CIDR of the VPC (e.g. `172.16.0.0/16`)
- `wickr/vpc:publicSubnetIds` - A comma-separated list of public subnets in the VPC. The Application Load Balancer and calling EKS worker nodes will be deployed in these subnets. (e.g. `subnet-6ce9941,subnet-1785141,subnet-2e7dc10`)
- `wickr/vpc:privateSubnetIds` - A comma-separated list of private subnets in the VPC. The EKS worker nodes and bastion server will be deployed in these subnets. (e.g. `subnet-f448ea8,subnet-3eb0da4,subnet-ad800b5`)
- `wickr/vpc:isolatedSubnetIds` - A comma-separated list of isolated subnets in the VPC. The RDS database will be deployed in these subnets. (e.g. `subnet-d1273a2,subnet-33504ae,subnet-0bc83ac`)
- `wickr/vpc:availabilityZones` - A comma-separated list of availability zones for the subnets in the VPC (e.g. `us-east-1a,us-east-1b,us-east-1c`)

#### Other settings

See [Context Values](#Context-Values) below for a complete list of settings.

### Bootstrap

If this is your first time using CDK on this particular AWS account and region, you must first "bootstrap" the account in order to begin using CDK.

```
npx cdk bootstrap
```

### Deploy

This process will take around 45 minutes.

```
npx cdk deploy --all --require-approval=never
```

Once complete, the infrastructure has been created, and after around 5 mins, Wickr Enterprise will be installed in your cluster. You can begin connecting the cluster and accessing KOTS Admin Console.

You can find detailed installation log from CloudWatch log group named `/aws/lambda/WickrLambda-func*` in AWS console.

#### Create DNS Records

This step is not required if you used a Public Hosted Zone when configuring CDK above.

The output from the deployment process will include a value `WickrAlb.AlbDnsName` which is the DNS name of the load balancer. The output will look like:

```
WickrAlb.AlbDnsName = Wickr-Alb-1Q5IBPJR4ZVZR-409483305.us-west-2.elb.amazonaws.com
```

In this case, the DNS name is `Wickr-Alb-1Q5IBPJR4ZVZR-409483305.us-west-2.elb.amazonaws.com` and that is the value which should be used when creating a CNAME or A/AAAA (ALIAS) record for your domain name.

If you no longer have the output from the deployment, run the following command to display the load balancer DNS name:

```
aws cloudformation describe-stacks --stack-name WickrAlb \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' \
  --output text
```

## Connecting to the Kubernetes cluster

The EKS API is accessible only via a bastion server which is created as a part of the deployment. As a result, all `kubectl` commands must either be run on the bastion server itself or be proxied through the bastion server. A helper script is available at `./bin/eks-connect.sh` which will complete all necessary configuration to connect to your EKS cluster and begin running `kubectl` commands. If you prefer not to use this script, follow the rest of the manual setup instructions in this section.

### Manual setup for connecting to the Kubernetes API

The first time you're connecting to the cluster, you need to update your local kubeconfig file using the `aws eks update-kubeconfig` command, and then set the `proxy-url` in your configuration. Then, each time you wish to connect to the cluster, you must start an SSM session with the bastion host to port forward to the proxy for API access.

ℹ️ These steps are optional if you are using the helper script at `./bin/eks-connect.sh`

#### One-time setup

There is an output value on the `WickrEks` CloudFormation stack with a name that begins with `WickrEnterpriseConfigCommand` which contains the full command needed to generate the kubectl configuration for your cluster. This output can be viewed with the following command:

```
aws cloudformation describe-stacks --stack-name WickrEks \
  --query 'Stacks[0].Outputs[?starts_with(OutputKey, `WickrEnterpriseConfigCommand`)].OutputValue' \
  --output text
```

This should output a command that begins with `aws eks update-kubeconfig`. Run this command.

Next, the Kubernetes configuration must be modified to proxy requests through the bastion host. This can be done using the following commands:

```
CLUSTER_ARN=$(aws cloudformation describe-stacks --stack-name WickrEks --query 'Stacks[0].Outputs[?OutputKey==`WickrEnterpriseEksClusterArn`].OutputValue' --output text)
kubectl config set "clusters.${CLUSTER_ARN}.proxy-url" http://localhost:8888
```

If it worked correctly, you will see output like 'Property "clusters.arn:aws:eks:us-west-2:012345678912:cluster/WickrEnterprise5B8BF472-1234a41c4ec48b7b615c6789d93dcce.proxy-url" set.'

#### Port forward to the bastion

Each time you want to connect to the EKS cluster, you will need to start an SSM session to port forward requests to the proxy running on your bastion server. The command to do this is provided as the output `BastionSSMProxyEKSCommand` on the `WickrEks` stack. You can run the following command to view the output value:

```
aws cloudformation describe-stacks --stack-name WickrEks \
  --query 'Stacks[0].Outputs[?OutputKey==`BastionSSMProxyEKSCommand`].OutputValue' \
  --output text
```

The command which it outputs will begin with `aws ssm start-session`. Run this command to start a local proxy running on port 8888 through which you can connect to the EKS cluster. If the port forward worked correctly, the output should say 'Waiting for connections...'. Leave this process running the entire time you need to access the EKS cluster.

If everything is set up correctly, you will be able to run `kubectl get nodes` in another terminal to list the worker nodes in the EKS cluster:

```
$ kubectl get nodes
NAME                           STATUS   ROLES    AGE     VERSION
ip-10-0-111-216.ec2.internal   Ready    <none>   3d      v1.26.4-eks-0a21954
ip-10-0-180-1.ec2.internal     Ready    <none>   2d23h   v1.26.4-eks-0a21954
ip-10-0-200-102.ec2.internal   Ready    <none>   3d      v1.26.4-eks-0a21954
```

## Post-Installation

There are two web consoles available for managing your Wickr Enterprise installation: the KOTS Admin Console and the Wickr Admin Console.

### KOTS Admin Console

This interface is used for managing the deployed version of Wickr Enterprise. Here you can see the status of the installation, modify configurations, or perform upgrades. The KOTS Admin Console is accessible only through a Kubernetes port forward, which can be opened using the following command:

```
kubectl kots --namespace wickr admin-console
```

Note that you will need to first set up your bastion connection as described above in the [Port forward to the bastion](#port-forward-to-the-bastion) section.

When the port forward is successfully configured, the command above will output:

```
  • Press Ctrl+C to exit
  • Go to http://localhost:8800 to access the Admin Console
```

At which point you can visit the provided URL to access the KOTS Admin Console. The password to login is stored in AWS Secrets Manager in the secret named `wickr/kots`.  Here is a command to retrieve it:

```bash
aws secretsmanager get-secret-value --secret-id wickr/kots --query SecretString --output text
```

See the [Resetting the KOTS Admin Console Password](#resetting-the-kots-admin-console-password) section below if you need to reset the password.

### Wickr Admin Console

This interface is used for configuring your Wickr Enterprise installation to set up networks, users, federation, etc. It is accessible over HTTPS at the DNS name which you configured to point to your Load Balancer. If DNS was configured automatically with a Public Hosted Zone, the domain name is the value of the `wickr/domainName` context value.

The default username is `admin` with the password `Password123`. You will be forced to change this password on first login.

### RDS connections

Each time you want to connect to the RDS database, you will need to start an SSM session to port forward requests to the proxy running on your bastion server. The command to do this is provided as the output `BastionSSMProxyRDSCommand` on the `WickrEKS` stack. You can run the following command to view the output value:
```
aws cloudformation describe-stacks --stack-name WickrEks \
  --query 'Stacks[0].Outputs[?OutputKey==`BastionSSMProxyRDSCommand`].OutputValue' \
  --output text
```

The command which it outputs will begin with `aws ssm start-session`. Run this command to start a local proxy running on port 3306 through which you can connect to the RDS database. If the port forward worked correctly, the output should say 'Waiting for connections...'. Leave this process running the entire time you need to access the RDS database.

If everything is set up correctly, you will be able to run `mysql -u$MYSQL_USER -p$MYSQL_PASSWORD -h 127.0.0.1` in another terminal to connect to the RDS database.

## Context Values

| Name  |  Description |  Default |
|---|---|---|
| `wickr/licensePath` | The path to your KOTS license (a `.yaml` file provided by Wickr) | null |
| `wickr/domainName` | The domain name to use for this Wickr Enterprise deployment. If using a Route53 Public Hosted Zone, DNS records and ACM certificates for this domain name will be automatically created. |  null |
| `wickr/route53:hostedZoneId` | Route53 Hosted Zone ID in which to create DNS records | null |
| `wickr/route53:hostedZoneName` | Route53 Hosted Zone Name in which to create DNS records | null |
| `wickr/acm:certificateArn` | ARN of an ACM or IAM server certificate to use on the Load Balancer. This value must be supplied if a Route53 Public Hosted Zone is not available in your account. | null |
| `wickr/caPath` | Certificate path, only required when using self-signed certificates | null |
| `wickr/vpc:id` | ID of the VPC to deploy resources into. Only required when deploying into an existing VPC. If unset, a new VPC will be created. | null |
| `wickr/vpc:cidr` | IPv4 CIDR to associate with the created VPC. If deploying into an existing VPC, set this to the CIDR of the existing VPC. | 172.16.0.0/16 |
| `wickr/vpc:availabilityZones` | Comma-separated list of availability zones. Only required when deploying into an existing VPC. | null |
| `wickr/vpc:publicSubnetIds` | Comma-separated list of public subnet IDs. Only required when deploying into an existing VPC. | null |
| `wickr/vpc:privateSubnetIds` | Comma-separated list of private subnet IDs. Only required when deploying into an existing VPC. | null |
| `wickr/vpc:isolatedSubnetIds` | Comma-separated list of isolated subnet IDs for the RDS database. Only required when deploying into an existing VPC. | null |
| `wickr/rds:deletionProtection` | Enable deletion protection on RDS instances | true |
| `wickr/rds:removalPolicy` | Removal policy for RDS instances. 'snapshot', 'destroy', or 'retain' | snapshot |
| `wickr/rds:readerCount` | Number of reader instances to create in the RDS cluster | 1 |
| `wickr/rds:instanceType` | Instance type to use for RDS instances | r6g.xlarge |
| `wickr/rds:backupRetentionDays` | Number of days to retain backups | 14 |
| `wickr/rds:mySqlVersion` | MySQL version (5.7 or 8.0) | 8.0 |
| `wickr/eks:namespace` | Default namespace for Wickr services in EKS | wickr |
| `wickr/eks:defaultCapacity` | Number of EKS worker nodes for Messaging infrastructure | 3 |
| `wickr/eks:defaultCapacityCalling` | Number of EKS worker nodes for Calling infrastructure | 2 |
| `wickr/eks:instanceTypes` | Comma-separated list of instance types to use for Messaging EKS worker nodes | m5.xlarge |
| `wickr/eks:instanceTypesCalling` | Comma-separated list of instance types to use for Calling EKS worker nodes | c5n.large |
| `wickr/eks:enableAutoscaler` | Toggles enabling the Cluster Autoscaler functionality for EKS | true |
| `wickr/s3:expireAfterDays` | Number of days after which file uploads will be removed from the S3 bucket | 1095 |
| `wickr/eks:clusterVersion` | Cluster versions, including Kubernetes version, kubectlLayer version, albController version, nodeGroupRelease version and more | 1.27 |
| `wickr/stackSuffix` | A suffix to apply to Cloudformation stack names | '' |
| `wickr/autoDeployWickr` | Auto deploy the Wickr application via lambda | true |
| `wickr/kms:kmsKey` | ARN of an existing KMS key to import | null |
| `wickr/alb:disableIpv6` | (Optional) Sets the ALB IP address type to IPv4. Default is dualstack | false |
| `wickr/alb:privateAddress` | (Optional) Places the ALB in private subnets. Default is public subnets. Note: This does not change the ALB scheme to be internal. | false |
| `wickr/enableCallingIngress` | Adds support for calling ingress via NLB | false |
| `wickr/replicatedChannel` | (Optional) Override Replicated Channel | '' |

## Destroying Resources

To delete everything created by this CDK application, deletion protection for the RDS cluster must be disabled and the removal policy must be set to either `snapshot` or `destroy`. If these are not the current settings, modify the `wickr/rds:deletionProtection` and `wickr/rds:removalPolicy` values in your CDK context and redeploy the RDS stack by running `npx cdk deploy -e WickrRds`.

Once the deletion protection and removal policy are properly set, run the following command to destroy all of the CloudFormation stacks:

```
npx cdk destroy --all
```

## Troubleshooting

### Deleting the wickr namespace

If you ever need to delete the `wickr` namespace to start over, it is important that you first backup any Service Accounts which were created by CDK within that namespace. These Service Accounts allow Wickr services to communicate with AWS APIs via IAM roles, and without them things like file uploads via S3 will no longer work.

Here is a command to backup the Service Accounts and then delete and re-create the `wickr` namespace and the appropriate Service Accounts:

```
kubectl -n wickr get sa fileproxy -o yaml > fileproxy-sa.yaml && \
  kubectl delete ns wickr && \
  kubectl create ns wickr && \
  kubectl -n wickr apply -f fileproxy-sa.yaml
```

### Resetting the KOTS Admin Console password

```
kubectl kots -n wickr reset-password
```

When you change this password you may also want to update the `wickr/kots` Secrets Manager secret as well, although it will generally not be used again by any automation.

### Installing Wickr Enterprise via Lambda

During the CDK deployment, a Lambda is created and invoked to complete the Wickr Enterprise installation on your behalf automatically. To invoke it manually, open AWS console and find `WickrLambda-func*` lambda function, under test tab, click `test`, the input is irrelevant.

### Installing Wickr Enterprise Manually

Once your connection to the Kubernetes cluster has been made, you can begin installing Wickr Enterprise using the `kubectl kots` plugin. You'll need your KOTS license file (a `.yaml` file provided by Wickr) and KOTS config file (`wickr-config.json`).

#### Generate KOTS Config

The Wickr Enterprise installer requires a number of configuration values about the infrastructure in order to install successfully. To simplify this process, there is a helper script to generate these configuration values.

```bash
./bin/generate-kots-config.ts > wickr-config.json
```

If you imported an external certificate into ACM in the first step, pass the `--ca-file` flag to to this script, e.g.:

```bash
./bin/generate-kots-config.ts --ca-file path/to/chain.pem > wickr-config.json
```

If you receive an error saying the stack does not exist, set the `AWS_REGION` environment variable (e.g. `export AWS_REGION=us-west-2`) to your selected region and try again. Or, if you set the context value `wickr/stackSuffix`, pass the suffix with the `--stack-suffix` flag.

WARNING: This file contains sensitive information about your installation. Do not share or save it publicly.

#### Installation

Install Wickr Enterprise:

```bash
kubectl kots install wickr-enterprise-ha \
  --license-file ./license.yaml \
  --config-values ./wickr-config.json  \
  --namespace wickr \
  --skip-preflights
```

You will be prompted to enter a password for the KOTS Admin Console. Save this password because it will be needed for upgrading or changing the configuration of your Wickr Enterprise installation in the future.

When the installation is complete, `kubectl kots` will open up a local port (usually `http://localhost:8080`) which provides access to the KOTS Admin Console. You can change or monitor the status of your Wickr Enterprise installation on this site, or begin setting up Wickr by visiting the domain name you configured for your installation in your browser.

### Updates to Bottlerocket nodes

EKS nodes are deployed with Bottlerocket OS and patching updates to these nodes can be automated by installing bottlerocket update operator into the cluster.

#### To update manually:
Connect to the nodes individually by starting a session using SSM to access the Bottlerocket API.
run the below command to check and apply the update if there's any and reboot the instance to activate the update.
```
apiclient update check && apiclient update apply && apiclient reboot
```

### Issues connecting to EKS cluster via bastion

If your connection to the EKS cluster through the bastion seems slow or is timing out occasionally, you may see the following error when running `kubectl` commands:

> net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)

This issue can often be remedied by logging into the bastion host via SSM (see the `BastionSSMCommand` on the WickrEks stack) and restarting the `tinyproxy` service:

```
sudo systemctl restart tinyproxy
```
