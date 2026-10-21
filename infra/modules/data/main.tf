resource "aws_dynamodb_table" "sources" {
  name         = "${var.name_prefix}-sources"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sourceId"

  attribute {
    name = "sourceId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_dynamodb_table" "posts" {
  name         = "${var.name_prefix}-posts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "postId"

  attribute {
    name = "postId"
    type = "S"
  }
  attribute {
    name = "feedKey"
    type = "S"
  }
  attribute {
    name = "sourceId"
    type = "S"
  }
  attribute {
    name = "publishedAt"
    type = "S"
  }

  global_secondary_index {
    name            = "byPublished"
    hash_key        = "feedKey"
    range_key       = "publishedAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "bySource"
    hash_key        = "sourceId"
    range_key       = "publishedAt"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# Single-item table (id = "global") holding crawl settings edited from the Sources page.
resource "aws_dynamodb_table" "settings" {
  name         = "${var.name_prefix}-settings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# Anonymous Web Push subscriptions (id = sha256 of the endpoint). Disposable: browsers re-subscribe.
resource "aws_dynamodb_table" "push_subscriptions" {
  name         = "${var.name_prefix}-push-subscriptions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}
