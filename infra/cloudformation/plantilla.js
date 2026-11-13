import { appCommit, capas, scriptsArranque } from '../arranque.js';

const proyecto = 'proyecto-final-modulo-2';
const secretosPorRol = { frontend: [], backend: ['Db', 'Admin'], database: ['Db'] };
const ref = (nombre) => ({ Ref: nombre });
const atributo = (nombre, campo) => ({ 'Fn::GetAtt': [nombre, campo] });
const capital = (valor) => valor[0].toUpperCase() + valor.slice(1);
const etiquetas = (datos) => Object.entries(datos).map(([Key, Value]) => ({ Key, Value }));
const recurso = (tipo, propiedades, why, must) => ({
  Type: tipo, Properties: propiedades,
  Metadata: { 'com.aws.cloudformation.Context': { why, ...(must && { must }) } },
});

export function nombrePila(tenant) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant) || tenant.length < 3 || tenant.length > 40) {
    throw new Error('El identificador del tenant no es válido.');
  }
  return `pfm2-cfn-${tenant}`;
}

export function etiquetasPila(tenant) {
  return etiquetas({ Project: proyecto, Tenant: tenant.identificador, Environment: tenant.entorno, ManagedBy: 'CloudFormation' });
}

export function prefijoSecretos(tenant) {
  return `/asistencia/${proyecto}/${tenant}/cloudformation`;
}

export async function generarPlantilla(tenant, { ami, discoRaiz, limite }) {
  const nombre = nombrePila(tenant.identificador);
  const prefijo = prefijoSecretos(tenant.identificador);
  const marcas = Object.fromEntries(etiquetasPila(tenant).map(({ Key, Value }) => [Key, Value]));
  const tags = (sufijo, extra = {}) => etiquetas({ ...marcas, Name: sufijo ? `${nombre}-${sufijo}` : nombre, ...extra });
  const recursos = {
    Red: recurso('AWS::EC2::VPC', {
      CidrBlock: '10.248.0.0/16', EnableDnsSupport: true, EnableDnsHostnames: true, Tags: tags(),
    }, 'Red dedicada al tenant.', 'Cada tenant requiere una VPC propia.'),
    Subred: recurso('AWS::EC2::Subnet', {
      VpcId: ref('Red'), CidrBlock: '10.248.1.0/24', Tags: tags(),
    }, 'Subred para las tres capas y sus direcciones privadas.'),
    Internet: recurso('AWS::EC2::InternetGateway', { Tags: tags() }, 'Salida HTTPS para arranque y Systems Manager.'),
    AdjuntarInternet: recurso('AWS::EC2::VPCGatewayAttachment', {
      VpcId: ref('Red'), InternetGatewayId: ref('Internet'),
    }, 'Asocia la puerta de enlace a la VPC del tenant.'),
    TablaRutas: recurso('AWS::EC2::RouteTable', { VpcId: ref('Red'), Tags: tags() }, 'Rutas de la subred dedicada.'),
    RutaInternet: {
      ...recurso('AWS::EC2::Route', {
        RouteTableId: ref('TablaRutas'), DestinationCidrBlock: '0.0.0.0/0', GatewayId: ref('Internet'),
      }, 'Salida de la subred para descargar paquetes y alcanzar servicios AWS.'),
      DependsOn: 'AdjuntarInternet',
    },
    AsociarRuta: recurso('AWS::EC2::SubnetRouteTableAssociation', {
      SubnetId: ref('Subred'), RouteTableId: ref('TablaRutas'),
    }, 'Asocia las rutas a la subred del tenant.'),
  };
  for (const secreto of ['Db', 'Admin']) {
    recursos[`Secreto${secreto}`] = {
      ...recurso('AWS::SecretsManager::Secret', {
        Name: `${prefijo}/${secreto.toLowerCase()}`,
        GenerateSecretString: { PasswordLength: 48, ExcludePunctuation: true, IncludeSpace: false },
        Tags: tags(secreto.toLowerCase()),
      }, 'Genera una credencial de arranque por tenant.', 'El valor se lee en EC2 y nunca se incluye en la plantilla.'),
      DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Retain',
    };
  }
  for (const [origen, destino, puerto] of [['Frontend', 'Backend', 8090], ['Backend', 'Database', 3306]]) {
    const regla = { IpProtocol: 'tcp', FromPort: puerto, ToPort: puerto };
    recursos[`Entrada${destino}`] = recurso('AWS::EC2::SecurityGroupIngress', {
      ...regla, GroupId: ref(`Seguridad${destino}`), SourceSecurityGroupId: ref(`Seguridad${origen}`),
    }, 'Permite tráfico únicamente desde la capa anterior de este tenant.');
    recursos[`Salida${origen}`] = recurso('AWS::EC2::SecurityGroupEgress', {
      ...regla, GroupId: ref(`Seguridad${origen}`), DestinationSecurityGroupId: ref(`Seguridad${destino}`),
    }, 'Limita el tráfico interno a la siguiente capa de este tenant.');
  }

  const scripts = await scriptsArranque(prefijo,
    'aws secretsmanager get-secret-value --region us-east-2 --query SecretString --output text --secret-id "$parameter_prefix/$1"');
  const salidas = { VpcId: { Value: ref('Red') }, AppCommit: { Value: appCommit } };
  for (const [rol, datos] of Object.entries(capas)) {
    const id = capital(rol);
    const capacidad = tenant.plan.recursos.find(({ rol }) => rol === datos.nombre);
    if (!capacidad) throw new Error('Falta una capa en el plan del tenant.');
    recursos[`Seguridad${id}`] = recurso('AWS::EC2::SecurityGroup', {
      VpcId: ref('Red'), GroupDescription: `Capa ${rol} del tenant`,
      SecurityGroupEgress: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' }],
      Tags: tags(rol),
    }, 'Controla el tráfico de una capa.', 'Sin puertos de administración abiertos ni entrada pública.');
    const permisos = [{
      Effect: 'Allow', Resource: '*',
      Action: ['ssm:UpdateInstanceInformation', 'ssmmessages:CreateControlChannel', 'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel', 'ssmmessages:OpenDataChannel'],
    }];
    if (secretosPorRol[rol].length) permisos.push({
      Effect: 'Allow', Action: 'secretsmanager:GetSecretValue',
      Resource: secretosPorRol[rol].map((secreto) => ref(`Secreto${secreto}`)),
    });
    recursos[`Rol${id}`] = recurso('AWS::IAM::Role', {
      RoleName: `${nombre}-${rol}`, PermissionsBoundary: limite,
      AssumeRolePolicyDocument: {
        Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { Service: 'ec2.amazonaws.com' } }],
      },
      Policies: [{ PolicyName: 'ArranqueDelTenant', PolicyDocument: { Version: '2012-10-17', Statement: permisos } }],
      Tags: tags(rol),
    }, 'Permite Systems Manager y, cuando aplica, lectura de los secretos del tenant.', 'Mantener el límite IAM del proyecto.');
    recursos[`Perfil${id}`] = recurso('AWS::IAM::InstanceProfile', {
      InstanceProfileName: `${nombre}-${rol}`, Roles: [ref(`Rol${id}`)],
    }, 'Vincula a la EC2 con el rol de su capa.');
    recursos[`Instancia${id}`] = {
      ...recurso('AWS::EC2::Instance', {
        ImageId: ami, InstanceType: capacidad.instancia, IamInstanceProfile: ref(`Perfil${id}`),
        NetworkInterfaces: [{
          DeviceIndex: '0', SubnetId: ref('Subred'), PrivateIpAddress: datos.ip,
          AssociatePublicIpAddress: true, GroupSet: [ref(`Seguridad${id}`)],
        }],
        CreditSpecification: { CPUCredits: 'standard' },
        MetadataOptions: { HttpEndpoint: 'enabled', HttpTokens: 'required', HttpPutResponseHopLimit: 1 },
        BlockDeviceMappings: [{ DeviceName: discoRaiz, Ebs: {
          VolumeType: 'gp3', VolumeSize: capacidad.discoGiB, Encrypted: true, DeleteOnTermination: true,
        } }],
        PropagateTagsToVolumeOnCreation: true,
        UserData: { 'Fn::Base64': scripts[rol] }, Tags: tags(rol, { Role: rol }),
      }, 'Ejecuta una capa de UAGRM Asistencia con la capacidad del catálogo.',
      'Conservar el disco durante la suspensión. El retiro confirmado elimina la EC2 y su disco raíz.'),
      DependsOn: ['RutaInternet', 'AsociarRuta', 'EntradaBackend', 'EntradaDatabase', 'SalidaFrontend', 'SalidaBackend'],
    };
    salidas[`Instancia${id}`] = { Value: ref(`Instancia${id}`) };
  }
  salidas.FrontendPrivado = { Value: atributo('InstanciaFrontend', 'PrivateIp') };
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Tenant aislado de UAGRM Asistencia en AWS Ohio, administrado desde el panel del proyecto.',
    Metadata: { AWSToolsMetrics: { AWSAgentToolkit: 'aws-cloudformation@3' } },
    Resources: recursos, Outputs: salidas,
  };
}
