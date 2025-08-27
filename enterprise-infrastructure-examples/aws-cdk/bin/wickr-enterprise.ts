#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { VpcStack } from '../lib/stacks/vpc'
import { EksStack } from '../lib/stacks/eks'
import { KmsStack } from '../lib/stacks/kms'
import { S3Stack } from '../lib/stacks/s3'
import { RdsStack } from '../lib/stacks/rds'
import { AcmStack } from '../lib/stacks/acm'
import { AlbStack } from '../lib/stacks/alb'
import { NlbStack } from '../lib/stacks/nlb'
import { KotsStack } from '../lib/stacks/kots'
import { getEnvironmentConfig } from '../lib/util'

const app = new App()

const environmentConfig = getEnvironmentConfig(app)

const suffix = environmentConfig.stackSuffix

const kmsStack = new KmsStack(app, `WickrKms${suffix}`, environmentConfig)

const s3Stack = new S3Stack(app, `WickrS3${suffix}`, environmentConfig, {
  key: kmsStack.key,
})

const vpcStack = new VpcStack(app, `WickrVpc${suffix}`, {
  config: environmentConfig,
  env: environmentConfig.importedVpcId ? {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  } : undefined,
})

const acmStack = new AcmStack(app, `WickrAcm${suffix}`, environmentConfig)

const albStack = new AlbStack(app, `WickrAlb${suffix}`, environmentConfig, {
  vpc: vpcStack.vpc,
  certificate: acmStack.certificate,
})

const nlbStack = environmentConfig.enableCallingIngress ? new NlbStack(app, `WickrNlb${suffix}`, environmentConfig, {
    vpc: vpcStack.vpc,
    certificate: acmStack.certificate,
  }) : undefined

const rdsStack = new RdsStack(app, `WickrRds${suffix}`, environmentConfig, {
  vpc: vpcStack.vpc,
  key: kmsStack.key,
})

const eksStack = new EksStack(app, `WickrEks${suffix}`, environmentConfig, {
  vpc: vpcStack.vpc,
  key: kmsStack.key,
  bucket: s3Stack.bucket,
  database: rdsStack.cluster,
  alb: albStack.alb,
  nlb: nlbStack?.nlb
})

if (environmentConfig.autoDeployWickr) {
  new KotsStack(app, `WickrLambda${suffix}`, environmentConfig, {
    vpc: vpcStack.vpc,
    cluster: eksStack.cluster,
    clusterAdmin: eksStack.clusterAdmin,
  })
}
