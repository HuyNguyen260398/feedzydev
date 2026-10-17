terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # `bucket` and `region` are supplied at init time via -backend-config.
  backend "s3" {
    key          = "feedzydev-claude/prod/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "feedzydev-claude"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "feedzydev-claude"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}
