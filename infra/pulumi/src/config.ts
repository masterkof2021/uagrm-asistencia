import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { readFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export const config = new pulumi.Config();
export const project = "globomatics";
// Conservar nombres de AWS aunque el stack de Pulumi tenga otro nombre.
export const suffix = `${project}-lab`;
export const sshSourceCidr = config.get("sshSourceCidr") ?? "181.114.108.136/32";
const [address, mask, extra] = sshSourceCidr.split("/");
if (!isIPv4(address) || mask !== "32" || extra !== undefined) {
  throw new Error("sshSourceCidr debe ser una dirección IPv4 con máscara /32.");
}
const keyPath = config.get("sshPublicKeyPath") ?? "~/globomatics-ec2.pub";
const expandedKeyPath = keyPath.startsWith("~/") ? join(homedir(), keyPath.slice(2)) : keyPath;
export const publicKey = readFileSync(expandedKeyPath, "utf8").trim();
if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+) [A-Za-z0-9+/]+={0,2}(?:\s|$)/.test(publicKey)) {
  throw new Error("sshPublicKeyPath debe apuntar a una clave pública OpenSSH, nunca a la privada.");
}
export const tags = (name: string) => ({ Name: name, Project: project, ManagedBy: "Pulumi" });
export const provider = new aws.Provider("globomatics", {
  region: (new pulumi.Config("aws").get("region") ?? "us-east-2") as aws.Region,
  allowedAccountIds: ["222234418877"],
  defaultTags: { tags: { Project: project, ManagedBy: "Pulumi" } },
});
export const options = { provider };
