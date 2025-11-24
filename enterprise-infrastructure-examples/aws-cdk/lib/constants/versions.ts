import { AlbControllerVersion, KubernetesVersion } from 'aws-cdk-lib/aws-eks'
import { ILayerVersion } from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'
import { KubectlV27Layer } from '@aws-cdk/lambda-layer-kubectl-v27'
import { KubectlV28Layer } from '@aws-cdk/lambda-layer-kubectl-v28'
import { KubectlV29Layer } from '@aws-cdk/lambda-layer-kubectl-v29'
import { KubectlV30Layer } from '@aws-cdk/lambda-layer-kubectl-v30'
import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31'
import { AuroraMysqlEngineVersion } from 'aws-cdk-lib/aws-rds'

export interface ClusterVersion {
  kubernetesVersion: KubernetesVersion
  kubectlLayerVersion: (scope: Construct) => ILayerVersion
  albControllerVersion: AlbControllerVersion
  /* nodeGroupReleaseVersion
   * https://github.com/bottlerocket-os/bottlerocket/blob/develop/CHANGELOG.md
   * cli: aws ec2 describe-images --owners amazon --filters "Name=image-id,Values=$(aws ssm get-parameter --name '/aws/service/bottlerocket/aws-k8s-1.27/x86_64/latest/image_id' --query Parameter.Value --output text)" --query 'Images[*].[Name]' --output text | awk -F "-v" '{print $NF}'
   */
  nodeGroupReleaseVersion?: string
  ebsAddonVersion?: string
}

export const CLUSTER_VERSION: { [version: string]: ClusterVersion } = {
  '1.27': {
    kubernetesVersion: KubernetesVersion.V1_27,
    kubectlLayerVersion: (scope: Construct) => new KubectlV27Layer(scope, 'KubectlV27Layer'),
    albControllerVersion: AlbControllerVersion.V2_8_2,
    nodeGroupReleaseVersion: '1.30.0-ca9b9399',
  },
  '1.28': {
    kubernetesVersion: KubernetesVersion.V1_28,
    kubectlLayerVersion: (scope: Construct) => new KubectlV28Layer(scope, 'KubectlV28Layer'),
    albControllerVersion: AlbControllerVersion.V2_8_2,
    nodeGroupReleaseVersion: '1.30.0-ca9b9399',
  },
  '1.29': {
    kubernetesVersion: KubernetesVersion.V1_29,
    kubectlLayerVersion: (scope: Construct) => new KubectlV29Layer(scope, 'KubectlV29Layer'),
    albControllerVersion: AlbControllerVersion.V2_8_2,
    nodeGroupReleaseVersion: '1.30.0-ca9b9399',
  },
  '1.30': {
    kubernetesVersion: KubernetesVersion.V1_30,
    kubectlLayerVersion: (scope: Construct) => new KubectlV30Layer(scope, 'KubectlV30Layer'),
    albControllerVersion: AlbControllerVersion.V2_8_2,
    nodeGroupReleaseVersion: '1.30.0-ca9b9399',
  },
  '1.31': {
    kubernetesVersion: KubernetesVersion.V1_31,
    kubectlLayerVersion: (scope: Construct) => new KubectlV31Layer(scope, 'KubectlV31Layer'),
    albControllerVersion: AlbControllerVersion.V2_8_2,
    nodeGroupReleaseVersion: '1.30.0-ca9b9399',
  },
}

export const RDS_MYSQL_VERSION = {
  "5.7": AuroraMysqlEngineVersion.VER_2_11_4, // 5.7.mysql_aurora.2.11.4
  "8.0": AuroraMysqlEngineVersion.VER_3_08_0, // 8.0.mysql_aurora.3.08.0
}
