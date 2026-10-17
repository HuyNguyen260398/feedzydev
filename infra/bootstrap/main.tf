terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# State bucket (S3-native locking, no DynamoDB table)
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# GitHub OIDC CI roles (provider already exists: look up only)
# ---------------------------------------------------------------------------

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  prefix     = var.name_prefix
  oidc_arn   = data.aws_iam_openid_connect_provider.github.arn
  branch_sub = "repo:${var.github_repo}:ref:refs/heads/${var.deploy_branch}"
  pr_sub     = "repo:${var.github_repo}:pull_request"
  state_arn  = aws_s3_bucket.state.arn
  site_arn   = "arn:aws:s3:::${var.site_bucket_name}"
}

data "aws_iam_policy_document" "plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.pr_sub, local.branch_sub]
    }
  }
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.branch_sub]
    }
  }
}

resource "aws_iam_role" "plan" {
  name               = "feedzydev-claude-ci-plan"
  assume_role_policy = data.aws_iam_policy_document.plan_trust.json
}

resource "aws_iam_role" "deploy" {
  name               = "feedzydev-claude-ci-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy_attachment" "deploy_readonly" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# Plan role: read-only state access (CI plan runs with -lock=false).
data "aws_iam_policy_document" "plan_state" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${local.state_arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [local.state_arn]
  }
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "state-access"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_state.json
}

# Permissions boundary: the ceiling for every role the deploy role creates.
data "aws_iam_policy_document" "boundary" {
  statement {
    sid     = "DynamoDb"
    actions = ["dynamodb:*"]
    resources = [
      "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${local.prefix}-*",
      "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${local.prefix}-*/index/*",
    ]
  }

  statement {
    sid       = "LambdaInvoke"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:aws:lambda:${var.region}:${local.account_id}:function:${local.prefix}-*"]
  }

  statement {
    sid     = "Logs"
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      "arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${local.prefix}-*",
      "arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${local.prefix}-*:*",
    ]
  }
}

resource "aws_iam_policy" "boundary" {
  name   = "${local.prefix}-boundary"
  policy = data.aws_iam_policy_document.boundary.json
}

# Deploy role: scoped by resource ARN wherever the service supports it.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid     = "DynamoDb"
    actions = ["dynamodb:*"]
    resources = [
      "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${local.prefix}-*",
      "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${local.prefix}-*/index/*",
    ]
  }

  statement {
    sid       = "Lambda"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${var.region}:${local.account_id}:function:${local.prefix}-*"]
  }

  # Role writes that could escalate privilege are only allowed when the role
  # carries the permissions boundary.
  statement {
    sid = "IamRolesBounded"
    actions = [
      "iam:CreateRole",
      "iam:PutRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:PutRolePermissionsBoundary",
      "iam:UpdateAssumeRolePolicy",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.prefix}-*"]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.boundary.arn]
    }
  }

  statement {
    sid = "IamRolesOther"
    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRoleTags",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:DeleteRole",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.prefix}-*"]
  }

  statement {
    sid       = "IamPassRole"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.prefix}-*"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "scheduler.amazonaws.com"]
    }
  }

  statement {
    sid       = "DenyBoundaryRemoval"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }

  statement {
    sid    = "DenyBoundaryPolicyTamper"
    effect = "Deny"
    actions = [
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:SetDefaultPolicyVersion",
    ]
    resources = [aws_iam_policy.boundary.arn]
  }

  statement {
    sid = "IamPolicyReads"
    actions = [
      "iam:GetPolicy*",
      "iam:ListPolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = ["*"]
  }

  statement {
    sid     = "Logs"
    actions = ["logs:*"]
    resources = [
      "arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${local.prefix}-*",
      "arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${local.prefix}-*:*",
    ]
  }

  statement {
    sid       = "LogsDescribe"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  statement {
    sid       = "Scheduler"
    actions   = ["scheduler:*"]
    resources = ["arn:aws:scheduler:${var.region}:${local.account_id}:schedule/default/${local.prefix}-*"]
  }

  statement {
    sid       = "S3SiteBucket"
    actions   = ["s3:*"]
    resources = [local.site_arn, "${local.site_arn}/*"]
  }

  statement {
    sid       = "S3StateBucket"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.state_arn}/*"]
  }

  statement {
    sid       = "S3StateBucketList"
    actions   = ["s3:ListBucket", "s3:GetBucket*"]
    resources = [local.state_arn]
  }

  statement {
    sid       = "ApiGateway"
    actions   = ["apigateway:*"]
    resources = ["arn:aws:apigateway:${var.region}::/*"]
  }

  statement {
    sid       = "UnscopableServices"
    actions   = ["cloudfront:*", "cognito-idp:*", "acm:*"]
    resources = ["*"]
  }

  statement {
    sid       = "Route53Records"
    actions   = ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets"]
    resources = ["arn:aws:route53:::hostedzone/${var.hosted_zone_id}"]
  }

  statement {
    sid       = "Route53Reads"
    actions   = ["route53:GetChange", "route53:ListHostedZones*", "route53:GetHostedZone"]
    resources = ["*"]
  }

  statement {
    sid       = "Sts"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
