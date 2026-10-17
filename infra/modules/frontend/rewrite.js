function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.charAt(uri.length - 1) === "/") {
    request.uri = uri + "index.html";
  } else {
    var last = uri.substring(uri.lastIndexOf("/") + 1);
    if (last.indexOf(".") === -1) {
      request.uri = uri + "/index.html";
    }
  }
  return request;
}
