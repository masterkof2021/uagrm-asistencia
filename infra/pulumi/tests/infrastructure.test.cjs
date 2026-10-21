const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const pulumi = require('@pulumi/pulumi');

const temporary = mkdtempSync(join(tmpdir(), 'asistencia-pulumi-'));
const publicKeyPath = join(temporary, 'test.pub');
writeFileSync(publicKeyPath, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly test\n');
process.env.PULUMI_CONFIG = JSON.stringify({ 'asistencia-infra:sshPublicKeyPath': publicKeyPath });
const resources = [];
pulumi.runtime.setMocks({
  newResource(args) {
    resources.push(args);
    return { id: `${args.name}-id`, state: {
      ...args.inputs,
      publicIp: args.type === 'aws:ec2/instance:Instance' ? '203.0.113.10' : undefined,
    } };
  },
  call(args) {
    if (args.token === 'aws:index/getAvailabilityZones:getAvailabilityZones') return { names: ['us-east-2a'] };
    if (args.token === 'aws:ssm/getParameter:getParameter') {
      assert.equal(args.inputs.name, '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.18-x86_64');
      return { value: 'ami-test' };
    }
    throw new Error(`Consulta no simulada: ${args.token}`);
  },
}, 'asistencia-infra', 'lab', false);
after(() => rmSync(temporary, { recursive: true, force: true }));

test('equivalencia del laboratorio: red, seguridad, discos y salidas', async () => {
  const infra = await pulumi.runtime.runInPulumiStack(async () => require('../index.ts'));
  const servers = await new Promise(resolve => pulumi.output(infra.servers).apply(resolve));
  const awsResources = resources.filter(resource => resource.type.startsWith('aws:'));
  assert.equal(awsResources.length, 18);
  const ofType = type => awsResources.filter(resource => resource.type === type).map(resource => resource.inputs);
  assert.equal(ofType('aws:resourcegroups/group:Group').length, 1);
  const [provider] = resources.filter(resource => resource.type === 'pulumi:providers:aws');
  assert.deepEqual(JSON.parse(provider.inputs.allowedAccountIds), ['487450071663']);
  assert.equal(provider.inputs.region, 'us-east-2');
  const [vpc] = ofType('aws:ec2/vpc:Vpc');
  assert.equal(vpc.cidrBlock, '10.42.0.0/16');
  assert.equal(vpc.enableDnsHostnames, true);
  const [subnet] = ofType('aws:ec2/subnet:Subnet');
  assert.equal(subnet.cidrBlock, '10.42.1.0/24');
  assert.equal(subnet.mapPublicIpOnLaunch, false);
  assert.equal(subnet.availabilityZone, 'us-east-2a');
  const [route] = ofType('aws:ec2/routeTable:RouteTable');
  assert.equal(route.routes[0].cidrBlock, '0.0.0.0/0');
  assert.equal(route.routes[0].gatewayId, 'globomatics-id');
  const instances = ofType('aws:ec2/instance:Instance');
  assert.equal(instances.length, 2);
  for (const instance of instances) {
    const isClient = instance.tags.Role === 'client';
    assert.equal(instance.instanceType, 't3.micro');
    assert.equal(instance.ami, 'ami-test');
    assert.equal(instance.associatePublicIpAddress, true);
    assert.equal(instance.privateIp, isClient ? '10.42.1.10' : '10.42.1.20');
    assert.equal(instance.metadataOptions.httpTokens, 'required');
    assert.equal(instance.rootBlockDevice.encrypted, true);
    assert.equal(instance.rootBlockDevice.volumeType, 'gp3');
    assert.equal(instance.rootBlockDevice.volumeSize, isClient ? 12 : 20);
    assert.equal(instance.rootBlockDevice.deleteOnTermination, true);
    assert.equal(instance.userData, undefined);
  }
  const ingress = ofType('aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule');
  assert.equal(ingress.length, 5);
  assert.deepEqual(ingress.filter(rule => rule.cidrIpv4 === '0.0.0.0/0').map(rule => rule.fromPort).sort((a,b) => a-b), [80, 443]);
  for (const rule of ingress.filter(rule => rule.fromPort === 22)) assert.equal(rule.cidrIpv4, '181.114.108.136/32');
  const api = ingress.find(rule => rule.fromPort === 8090);
  assert.equal(api.referencedSecurityGroupId, 'globomatics-client-id');
  assert.equal(api.securityGroupId, 'globomatics-backend-id');
  assert.equal(api.cidrIpv4, undefined);
  assert.equal(ingress.some(rule => rule.fromPort === 3306), false);
  assert.equal(ofType('aws:vpc/securityGroupEgressRule:SecurityGroupEgressRule').length, 2);
  assert.equal(servers.client.private_ip, '10.42.1.10');
  assert.equal(servers.backend.private_ip, '10.42.1.20');
});
