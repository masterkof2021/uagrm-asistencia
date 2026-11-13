packer {
  required_version = ">= 1.14.2"
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "= 1.8.3"
    }
  }
}

variable "subred" { type = string }
variable "grupo_seguridad" { type = string }
variable "perfil_instancia" { type = string }
variable "ami_base" { type = string }

variable "version_imagen" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,39}$", var.version_imagen))
    error_message = "Usa hasta 40 caracteres, con minúsculas, números y guiones."
  }
}

locals {
  etiquetas = {
    Project      = "proyecto-final-modulo-2"
    ManagedBy    = "Packer"
    ImageVersion = var.version_imagen
    SourceAMI    = var.ami_base
  }
}

source "amazon-ebs" "asistencia" {
  region                      = "us-east-2"
  source_ami                  = var.ami_base
  ami_name                    = "pfm2-asistencia-${var.version_imagen}"
  instance_type               = "t3.micro"
  subnet_id                   = var.subred
  security_group_id           = var.grupo_seguridad
  associate_public_ip_address = true
  iam_instance_profile        = var.perfil_instancia
  ssh_username                = "ec2-user"
  ssh_interface               = "session_manager"
  ssh_clear_authorized_keys   = true
  ssh_timeout                 = "8m"
  imds_support                = "v2.0"

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  launch_block_device_mappings {
    device_name           = "/dev/xvda"
    volume_type           = "gp3"
    volume_size           = 8
    encrypted             = true
    delete_on_termination = true
  }

  tags          = local.etiquetas
  snapshot_tags = local.etiquetas
  run_tags      = merge(local.etiquetas, { Name = "pfm2-packer-${var.version_imagen}" })
}

build {
  sources = ["source.amazon-ebs.asistencia"]

  provisioner "shell" {
    execute_command = "sudo bash '{{ .Path }}'"
    script          = "${path.root}/preparar-base.sh"
  }

  post-processor "manifest" {
    output = "${path.root}/../../tmp/packer/manifest.json"
  }
}
