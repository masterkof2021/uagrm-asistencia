variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "Indica la cuenta AWS con 12 dígitos."
  }
}

variable "tenant_id" {
  type = string
  validation {
    condition     = length(var.tenant_id) >= 3 && length(var.tenant_id) <= 40 && can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", var.tenant_id))
    error_message = "Usa un identificador de 3 a 40 caracteres con letras minúsculas, números o guiones."
  }
}

variable "environment" {
  type    = string
  default = "pruebas"
  validation {
    condition     = contains(["pruebas", "produccion"], var.environment)
    error_message = "El entorno debe ser pruebas o produccion."
  }
}

variable "plan" {
  type = string
  validation {
    condition     = contains([for plan in jsondecode(file("${path.module}/../../plataforma/planes.json")) : plan.id], var.plan)
    error_message = "Elige un plan del catálogo de la plataforma."
  }
}

variable "availability_zone" {
  type    = string
  default = "us-east-2a"
  validation {
    condition     = can(regex("^us-east-2[abc]$", var.availability_zone))
    error_message = "Elige una zona de Ohio."
  }
}

variable "ami_id" {
  description = "AMI x86_64 de Amazon Linux 2023, fijada para este despliegue."
  type        = string
  validation {
    condition     = can(regex("^ami-[0-9a-f]{17}$", var.ami_id))
    error_message = "Indica un ID válido de AMI en Ohio."
  }
}

variable "operator_cidr" {
  description = "IPv4 pública /32 para SSH. Si se omite, usar Systems Manager."
  type        = string
  default     = null
  validation {
    condition     = var.operator_cidr == null ? true : can(cidrnetmask(var.operator_cidr)) && endswith(var.operator_cidr, "/32")
    error_message = "El acceso SSH requiere una IPv4 con máscara /32."
  }
}

variable "ssh_public_key" {
  description = "Contenido de la clave pública OpenSSH del operador."
  type        = string
  default     = null
  validation {
    condition     = var.ssh_public_key == null ? true : can(regex("^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+", trimspace(var.ssh_public_key)))
    error_message = "Indica una clave pública OpenSSH RSA o ED25519."
  }
}

variable "permissions_boundary_arn" {
  description = "Límite de permisos para los roles EC2 creados por el ejecutor del panel."
  type        = string
  default     = null
}

variable "app_commit" {
  description = "Commit de la aplicación base en el repositorio público de UAGRM Asistencia."
  type        = string
  default     = "ba7a8216be0c1c836925ea8964ad463295d961d0"
  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.app_commit))
    error_message = "Indica el SHA completo de 40 caracteres."
  }
}

variable "web_origin" {
  description = "Origen local del túnel SSH que puede acceder a la API."
  type        = string
  default     = "http://127.0.0.1:8080"
  validation {
    condition     = can(regex("^http://(127\\.0\\.0\\.1|localhost):[0-9]{1,5}$", var.web_origin))
    error_message = "Indica un origen HTTP local con el puerto del túnel."
  }
}

variable "use_ansible" {
  description = "Ejecutar los playbooks locales de Ansible al arrancar las EC2."
  type        = bool
  default     = false
}
