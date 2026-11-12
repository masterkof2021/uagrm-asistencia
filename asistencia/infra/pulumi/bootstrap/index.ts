import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const bucketName = "globomatics-pulumi-state-222234418877-us-east-2";
const provider = new aws.Provider("state-backend", {
  region: "us-east-2",
  allowedAccountIds: ["222234418877"],
  defaultTags: { tags: { Project: "globomatics", ManagedBy: "Pulumi", Purpose: "SharedState" } },
});
// El backend se administra por separado del laboratorio y se protege contra eliminación.
const options = { provider, protect: true };
const bucket = new aws.s3.Bucket("pulumi-state", {
  bucket: bucketName,
  forceDestroy: false,
  tags: { Name: bucketName },
}, options);
const publicAccess = new aws.s3.BucketPublicAccessBlock("pulumi-state", {
  bucket: bucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
}, options);
new aws.s3.BucketOwnershipControls("pulumi-state", {
  bucket: bucket.id,
  rule: { objectOwnership: "BucketOwnerEnforced" },
}, options);
new aws.s3.BucketVersioning("pulumi-state", {
  bucket: bucket.id,
  versioningConfiguration: { status: "Enabled" },
}, options);
new aws.s3.BucketServerSideEncryptionConfiguration("pulumi-state", {
  bucket: bucket.id,
  rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" } }],
}, options);
new aws.s3.BucketPolicy("pulumi-state", {
  bucket: bucket.id,
  policy: bucket.arn.apply(arn => JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Sid: "DenyInsecureTransport",
      Effect: "Deny",
      Principal: "*",
      Action: "s3:*",
      Resource: [arn, `${arn}/*`],
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    }],
  })),
}, { ...options, dependsOn: [publicAccess] });

export const stateBucket = bucket.id;
export const backendUrl = pulumi.interpolate`s3://${bucket.id}/globomatics?region=us-east-2`;
