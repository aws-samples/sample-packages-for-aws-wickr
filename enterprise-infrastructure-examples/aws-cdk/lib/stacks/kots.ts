import { Duration, Stack, StackProps } from 'aws-cdk-lib'
import { AwsCliLayer } from 'aws-cdk-lib/lambda-layer-awscli'
import { KubectlLayer } from 'aws-cdk-lib/lambda-layer-kubectl'
import { Construct } from 'constructs'
import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
  ManagedPolicy,
  PolicyDocument,
  IRole,
} from 'aws-cdk-lib/aws-iam'
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'
import { IVpc } from 'aws-cdk-lib/aws-ec2'
import { join } from 'path'
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { ICluster } from 'aws-cdk-lib/aws-eks'
import { Asset } from 'aws-cdk-lib/aws-s3-assets'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { CLUSTER_VERSION } from '../constants/versions'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'

export interface KotsStackProps extends StackProps {
  vpc: IVpc
  cluster: ICluster
  clusterAdmin: IRole
}

export class KotsStack extends Stack {
  private licenseAsset: Asset
  private caAsset: Asset

  constructor(scope: Construct, id: string, config: IWickrEnvironmentConfig, props: KotsStackProps) {
    super(scope, id)

    const licensePath = config.licensePath
    const secretName = `wickr/kots${config.stackSuffix}`

    if (!licensePath) {
      throw new Error('The context value `wickr/licensePath` must be set to the path of your Wickr Enterprise license')
    }

    this.licenseAsset = new Asset(this, 'WickrLicense', { path: licensePath })

    this.caAsset = new Asset(this, 'WickrCa', {
      path: config.caPath,
    })

    new Secret(this, 'WickrSecret', {
      secretName,
      description: 'Admin password for KOTS UI',
      generateSecretString: {
        passwordLength: 15,
        excludePunctuation: true,
      },
    })

    const role = new Role(this, 'KotsInstallRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        others: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['eks:DescribeCluster', 'eks:ListClusters', 'cloudformation:DescribeStacks'],
              resources: ['*'],
            }),
            new PolicyStatement({
              actions: ['secretsmanager:GetSecretValue'],
              resources: ['*'],
            }),
          ],
        }),
      },
    })
    props.clusterAdmin.grantAssumeRole(role)
    this.licenseAsset.grantRead(role)
    this.caAsset.grantRead(role)

    const lambdaFn = new Function(this, 'KotsInstallLambda', {
      runtime: Runtime.PYTHON_3_10,
      code: Code.fromAsset(join(__dirname, '../assets/lambda/kots-install')),
      handler: 'function.main',
      role: role,
      layers: [new AwsCliLayer(this, 'AwsCliLayer'), CLUSTER_VERSION[config.clusterVersion].kubectlLayerVersion(this)],
      timeout: Duration.minutes(5),
      memorySize: 512,
      retryAttempts: 0,
      vpc: props.vpc,
      securityGroups: [props.cluster.clusterSecurityGroup],
      environment: {
        CLUSTER_ROLE_ARN: props.clusterAdmin.roleArn,
        CLUSTER_NAME: props.cluster.clusterName,
        KOTS_SECRET_NAME: secretName,
        LICENSE_BUCKET: this.licenseAsset.s3BucketName,
        LICENSE_KEY: this.licenseAsset.s3ObjectKey,
        REPLICATED_CHANNEL: config.replicatedChannel,
        CA_BUCKET: this.caAsset.s3BucketName,
        CA_KEY: this.caAsset.s3ObjectKey,
        STACK_SUFFIX: config.stackSuffix,
      },
    })

    new AwsCustomResource(this, 'LambdaTrigger', {
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          effect: Effect.ALLOW,
          resources: [lambdaFn.functionArn],
        }),
      ]),
      timeout: Duration.minutes(15),
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: lambdaFn.functionName,
          InvocationType: 'Event',
        },
        physicalResourceId: PhysicalResourceId.of(`LambdaTrigger${Date.now().toString()}`),
      },
    })
  }
}
