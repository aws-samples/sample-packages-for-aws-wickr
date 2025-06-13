import hashlib
import os
import subprocess
import boto3
import json
import urllib3
import tarfile
import base64

http = urllib3.PoolManager()
eks = boto3.client('eks')
cf_client = boto3.client('cloudformation')
s3_client = boto3.client('s3')
secretsmanager = boto3.client('secretsmanager')
region = os.getenv('REGION', 'us-east-1')
cluster_role_arn = os.getenv('CLUSTER_ROLE_ARN')
cluster_name = os.getenv('CLUSTER_NAME')
kots_secret_name = os.getenv('KOTS_SECRET_NAME')
license_bucket = os.getenv('LICENSE_BUCKET')
license_key = os.getenv('LICENSE_KEY')
ca_bucket = os.getenv('CA_BUCKET')
ca_key = os.getenv('CA_KEY')
stack_suffix = os.getenv('STACK_SUFFIX', '')

os.environ['PATH'] = '/opt/kubectl:/opt/awscli:/tmp:' + os.environ['PATH']

kots_config_path = '/tmp/kots_config.json'
kots_license_path = '/tmp/kots_license.yaml'


def get_secret(secret_id):
    return secretsmanager.get_secret_value(SecretId=secret_id)['SecretString']

def get_stack_output_value(stack_name, output_key, default=None):
    response = cf_client.describe_stacks(StackName=f'{stack_name}{stack_suffix}')

    if len(response['Stacks']) < 1 or 'Outputs' not in response['Stacks'][0]:
        raise Exception(f'Could not find stack {stack_name}')

    for output in response['Stacks'][0]['Outputs']:
        if output['OutputKey'] == output_key:
            return output['OutputValue']

    if default is None:
        raise Exception(
            f'Could not find output key: {output_key} from the stack')

    return default

def download_kots_license():
    with open(kots_license_path, 'wb') as data:
        s3_client.download_fileobj(license_bucket, license_key, data)

def get_kots_ca():
    obj = s3_client.get_object(Bucket=ca_bucket, Key=ca_key)
    return obj['Body'].read()

def parse_kots_config():
    mysql_secret_arn = get_stack_output_value('WickrRds', 'DatabaseSecretArn')
    mysql_password = json.loads(get_secret(mysql_secret_arn))['password']

    ca_bytes = get_kots_ca()
    ca_str = base64.b64encode(ca_bytes).decode('utf-8')

    config = json.dumps({
        'apiVersion': 'kots.io/v1beta1',
        'kind': 'ConfigValues',
        'spec': {
            'values': {
                'hostname': {
                    'value': get_stack_output_value('WickrAcm', 'DomainName'),
                },
                'certificate_type': {
                    'value': 'certificate_type_acm',
                },
                'acm_arn': {
                    'value': get_stack_output_value('WickrAcm', 'CertificateArn'),
                },
                'ingress_controller_service_type': {
                    'value': 'ingress_controller_service_type_clusterip',
                },
                'ingress_controller_target_group_binding_arn': {
                    'value': get_stack_output_value('WickrAlb', 'AlbTargetGroupArn'),
                },
                'pinned_certificate_enabled': {
                    'value': '1',
                },
                'pinned_certificate': {
                    'filename': 'pinned-cert.pem',
                    'value': ca_str,
                },
                'mysql_host': {
                    'value': get_stack_output_value('WickrRds', 'DatabaseEndpoint'),
                },
                'mysql_reader_host': {
                    'value': get_stack_output_value('WickrRds', 'DatabaseEndpointRO', ''),
                },
                'mysql_user': {
                    'value': 'admin',
                },
                'mysql_password': {
                    'valuePlaintext': mysql_password,
                },
                's3_bucket': {
                    'value': get_stack_output_value('WickrS3', 'UploadBucketName'),
                },
                's3_region': {
                    'value': region,
                },
                's3_endpoint': {
                    'value': f's3.{region}.amazonaws.com',
                },
                'fileproxy_service_account_name': {
                    'value': 'fileproxy',
                },
                'cluster_autoscaler_enabled': {
                    'value': get_stack_output_value('WickrEks', 'ClusterAutoscalerEnabled', '0'),
                },
                'cluster_autoscaler_service_account': {
                    'value': 'cluster-autoscaler' if get_stack_output_value('WickrEks', 'ClusterAutoscalerEnabled', '0') == '1' else '',
                },
                'cluster_name': {
                    'value': get_stack_output_value('WickrEks', 'WickrEnterpriseEksClusterName'),
                },
                'cluster_aws_region': {
                    'value': region
                },
                'cluster_cloud_provider': {
                    'value': 'cluster_cloud_provider_aws',
                }
            }
        }
    })

    with open(kots_config_path, 'w') as file:
        file.write(config)


def get_cluster_list():
    try:
        response = eks.list_clusters()
        print(f'Results from get_cluster_list: {response}')
        return response['clusters']
    except Exception as e:
        raise Exception(
            f'Error: running get_cluster_list: Caught {type(e)}: {e}')


def get_kube_config(cluster, role_arn):
    kubeconfig = f'/tmp/{cluster}/kubeconfig'
    try:
        subprocess.check_call([
            '/opt/awscli/aws', 'eks', 'update-kubeconfig',
            '--role-arn', role_arn,
            '--name', cluster,
            '--kubeconfig', kubeconfig
        ])
        os.chmod(kubeconfig, 0o600)
        return kubeconfig
    except Exception as e:
        raise Exception(
            f'Error: running get_kube_config: Caught {type(e)}: {e}')


def kots_install(admin_password, kubeconfig):
    try:
        cmd = ['kubectl',
               'kots', 'install', 'wickr-enterprise-ha',
               '--shared-password', admin_password,
               '--license-file', kots_license_path,
               '--config-values', kots_config_path,
               '--namespace', 'wickr',
               '--skip-preflights',
               '--no-port-forward',
               '--kubeconfig', kubeconfig]
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        raise Exception(f'Error: running kots_install: Caught {type(e)}: {e}')


def install_kots():
    # A hack to get around lambda size limiation
    try:
        kots_version = '1.108.12'
        sha256sum = 'ef861e5f60da31ee48121c6974aa60cf846653cf34f4155c3d54dcd55cb0f5ad'

        kots = 'kots_linux_amd64.tar.gz'
        kots_path = f'/tmp/{kots}'
        kots_url = f'https://github.com/replicatedhq/kots/releases/download/v{kots_version}/{kots}'

        sha256 = hashlib.sha256()

        kots_request = http.request('GET', kots_url, preload_content=False)
        with open(kots_path, 'wb') as out:
            while True:
                data = kots_request.read(4096)
                if not data:
                    break
                out.write(data)
                sha256.update(data)
        kots_request.release_conn()

        if sha256.hexdigest() != sha256sum:
            raise Exception('Checksum does not match!')

        with tarfile.open(kots_path) as fh:
            fh.extract('kots', '/tmp')

        os.rename('/tmp/kots', '/tmp/kubectl-kots')
        os.remove(kots_path)
    except Exception as e:
        raise Exception(f'Error: running install_kots: Caught {type(e)}: {e}')


def main(event, context):
    print('Event: ' + str(event))
    print('Context: ' + str(context))

    clusters = get_cluster_list()
    for cluster in clusters:
        if cluster == cluster_name:
            download_kots_license()
            parse_kots_config()
            install_kots()
            kots_install(
                get_secret(kots_secret_name),
                get_kube_config(cluster, cluster_role_arn)
            )
            break
    return
