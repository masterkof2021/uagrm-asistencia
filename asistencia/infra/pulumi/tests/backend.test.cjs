const assert = require('node:assert/strict');
const { test } = require('node:test');
const pulumi = require('@pulumi/pulumi');
const resources = [];
pulumi.runtime.setMocks({
  newResource(args) {
    resources.push(args);
    return { id: args.inputs.bucket ?? args.name, state: {
      ...args.inputs,
      arn: args.type === 'aws:s3/bucket:Bucket' ? `arn:aws:s3:::${args.inputs.bucket}` : undefined,
    } };
  },
  call(args) { throw new Error(`Consulta inesperada: ${args.token}`); },
}, 'asistencia-state-backend', 'shared', false);

test('backend S3 privado, versionado, cifrado y con transporte seguro', async () => {
  const registered = [];
  const outputs = await pulumi.runtime.runInPulumiStack(async () => {
    pulumi.runtime.registerStackTransformation(({ resource }) => { registered.push(resource); });
    return require('../bootstrap/index.ts');
  });
  await Promise.all(registered.map(resource => new Promise(resolve => resource.urn.apply(resolve))));
  assert.equal(outputs.stateBucket, 'globomatics-pulumi-state-222234418877-us-east-2');
  const aws = resources.filter(resource => resource.type.startsWith('aws:'));
  assert.equal(aws.length, 6);
  const one = type => {
    const found = aws.filter(resource => resource.type === type);
    assert.equal(found.length, 1);
    return found[0].inputs;
  };
  assert.equal(one('aws:s3/bucket:Bucket').forceDestroy, false);
  const block = one('aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock');
  for (const field of ['blockPublicAcls', 'blockPublicPolicy', 'ignorePublicAcls', 'restrictPublicBuckets']) assert.equal(block[field], true);
  assert.equal(one('aws:s3/bucketOwnershipControls:BucketOwnershipControls').rule.objectOwnership, 'BucketOwnerEnforced');
  assert.equal(one('aws:s3/bucketVersioning:BucketVersioning').versioningConfiguration.status, 'Enabled');
  assert.equal(one('aws:s3/bucketServerSideEncryptionConfiguration:BucketServerSideEncryptionConfiguration').rules[0].applyServerSideEncryptionByDefault.sseAlgorithm, 'AES256');
  const policy = JSON.parse(one('aws:s3/bucketPolicy:BucketPolicy').policy);
  const [statement] = policy.Statement;
  assert.equal(statement.Effect, 'Deny');
  assert.equal(statement.Condition.Bool['aws:SecureTransport'], 'false');
  assert.deepEqual(statement.Resource, ['arn:aws:s3:::globomatics-pulumi-state-222234418877-us-east-2', 'arn:aws:s3:::globomatics-pulumi-state-222234418877-us-east-2/*']);
});
