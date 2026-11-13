const { createHmac } = require('node:crypto');
const pulumi = require('@pulumi/pulumi');
const aws = require('@pulumi/aws');
const { cuenta, tenant, entorno, ami, limite, capas, prefijo, appCommit } = require('./tenant.pulumi.json');

const proyecto = 'proyecto-final-modulo-2';
const nombre = `pfm2-pulumi-${tenant}`;
const tags = { Project: proyecto, Tenant: tenant, Environment: entorno, ManagedBy: 'Pulumi' };
const provider = new aws.Provider('tenant-aws', {
  region: 'us-east-2', allowedAccountIds: [cuenta], defaultTags: { tags },
});
const opciones = { provider };

const red = new aws.ec2.Vpc('red', {
  cidrBlock: '10.248.0.0/16', enableDnsSupport: true, enableDnsHostnames: true, tags: { Name: nombre },
}, opciones);
const subred = new aws.ec2.Subnet('subred', {
  vpcId: red.id, cidrBlock: '10.248.1.0/24', tags: { Name: nombre },
}, opciones);
const gateway = new aws.ec2.InternetGateway('internet', { vpcId: red.id, tags: { Name: nombre } }, opciones);
const tabla = new aws.ec2.RouteTable('rutas', {
  vpcId: red.id, routes: [{ cidrBlock: '0.0.0.0/0', gatewayId: gateway.id }], tags: { Name: nombre },
}, opciones);
const ruta = new aws.ec2.RouteTableAssociation('asociar-subred', {
  subnetId: subred.id, routeTableId: tabla.id,
}, opciones);

const grupos = Object.fromEntries(Object.keys(capas).map((rol) => [rol, new aws.ec2.SecurityGroup(`sg-${rol}`, {
  namePrefix: `${nombre}-${rol}-`, description: `Acceso de la capa ${rol} del tenant`,
  vpcId: red.id, tags: { Name: `${nombre}-${rol}` },
}, opciones)]));
const reglas = [];
for (const [origen, destino, puerto] of [['frontend', 'backend', 8090], ['backend', 'database', 3306]]) {
  const protocolo = { ipProtocol: 'tcp', fromPort: puerto, toPort: puerto };
  reglas.push(new aws.vpc.SecurityGroupIngressRule(`entrada-${destino}`, {
    ...protocolo, securityGroupId: grupos[destino].id, referencedSecurityGroupId: grupos[origen].id,
  }, opciones), new aws.vpc.SecurityGroupEgressRule(`salida-${origen}`, {
    ...protocolo, securityGroupId: grupos[origen].id, referencedSecurityGroupId: grupos[destino].id,
  }, opciones));
}
for (const [rol, grupo] of Object.entries(grupos)) {
  reglas.push(new aws.vpc.SecurityGroupEgressRule(`https-${rol}`, {
    securityGroupId: grupo.id, cidrIpv4: '0.0.0.0/0', ipProtocol: 'tcp', fromPort: 443, toPort: 443,
  }, opciones));
}

const clave = process.env.PULUMI_CONFIG_PASSPHRASE;
if (!/^[a-f0-9]{64}$/.test(clave ?? '')) throw new Error('Falta la clave local de la pila del tenant.');
const secretos = Object.fromEntries(['db', 'admin'].map((uso) => {
  const valor = createHmac('sha256', Buffer.from(clave, 'hex')).update(`pfm2/arranque/${tenant}/${uso}`).digest('hex').slice(0, 48);
  return [uso, new aws.ssm.Parameter(`arranque-${uso}`, {
    name: `${prefijo}/${uso}`, type: 'SecureString', tier: 'Standard', valueWo: pulumi.secret(valor), valueWoVersion: 1,
  }, opciones)];
}));
const accesos = { frontend: [], backend: ['db', 'admin'], database: ['db'] };
const politica = (Statement) => pulumi.jsonStringify({ Version: '2012-10-17', Statement });
const instancias = {};
for (const [rol, datos] of Object.entries(capas)) {
  const nombreRol = `${nombre}-${rol}`;
  const identidad = new aws.iam.Role(`rol-${rol}`, {
    name: nombreRol, path: `/${proyecto}/`, permissionsBoundary: limite,
    assumeRolePolicy: politica([{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { Service: 'ec2.amazonaws.com' } }]),
    tags: { Name: nombreRol },
  }, opciones);
  const canales = new aws.iam.RolePolicy(`canales-${rol}`, {
    name: 'ManagedInstanceChannels', role: identidad.name, policy: politica([{
      Effect: 'Allow', Resource: '*',
      Action: ['ssm:UpdateInstanceInformation', 'ssmmessages:CreateControlChannel', 'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel', 'ssmmessages:OpenDataChannel'],
    }]),
  }, opciones);
  const permisos = [canales];
  if (accesos[rol].length) {
    permisos.push(new aws.iam.RolePolicy(`secretos-${rol}`, {
      name: 'ReadTenantBootstrap', role: identidad.name,
      policy: politica([{ Effect: 'Allow', Action: 'ssm:GetParameter', Resource: accesos[rol].map((uso) => secretos[uso].arn) }]),
    }, opciones));
  }
  const perfil = new aws.iam.InstanceProfile(`perfil-${rol}`, {
    name: nombreRol, path: `/${proyecto}/`, role: identidad.name,
  }, opciones);
  const instancia = new aws.ec2.Instance(rol, {
    ami, instanceType: datos.instancia, subnetId: subred.id, privateIp: datos.ip, associatePublicIpAddress: true,
    vpcSecurityGroupIds: [grupos[rol].id], iamInstanceProfile: perfil.name, userData: datos.script,
    creditSpecification: { cpuCredits: 'standard' },
    metadataOptions: { httpEndpoint: 'enabled', httpTokens: 'required', httpPutResponseHopLimit: 1 },
    rootBlockDevice: {
      volumeType: 'gp3', volumeSize: datos.discoGiB, encrypted: true, deleteOnTermination: true, tags: { Name: nombreRol },
    },
    tags: { Name: nombreRol, Role: rol },
  }, { ...opciones, dependsOn: [ruta, ...reglas, ...permisos] });
  instancias[rol] = { id: instancia.id };
}
module.exports = { instances: instancias, appCommit };
