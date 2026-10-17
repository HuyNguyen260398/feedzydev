output "sources_table_name" {
  value = aws_dynamodb_table.sources.name
}

output "sources_table_arn" {
  value = aws_dynamodb_table.sources.arn
}

output "posts_table_name" {
  value = aws_dynamodb_table.posts.name
}

output "posts_table_arn" {
  value = aws_dynamodb_table.posts.arn
}
