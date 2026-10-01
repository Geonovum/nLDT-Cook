import utils from "../../../utils/utils.js";

export function get(req, res) {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto =
    (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const serviceUrl = `${proto}://${host}${req.baseUrl || ""}`;

  const content = {
    title: "Recipe Reader API",
    description:
      "An OGC API compliant server for reading and processing recipes.",
    links: [
      {
        href: serviceUrl,
        rel: "self",
        type: "application/json",
        title: "This document",
      },
      {
        href: `${serviceUrl}/conformance`,
        rel: "http://www.opengis.net/def/rel/ogc/1.0/conformance",
        type: "application/json",
        title: "OGC API conformance classes implemented by this server",
      },
      {
        href: `${serviceUrl}/conformance`,
        rel: "conformance",
        type: "application/json",
        title: "OGC API conformance classes implemented by this server",
      },
      {
        href: `${serviceUrl}/api`,
        rel: "service-desc",
        type: "application/vnd.oai.openapi+json;version=3.0",
        title: "Definition of the API",
      },
      {
        href: `${serviceUrl}/execute`,
        rel: "http://www.opengis.net/def/rel/ogc/1.0/execute",
        type: "application/json",
        title: "Execute a recipe",
      },
    ],
  };

  res.set("link", utils.makeHeaderLinks(content.links));
  res.status(200).json(content);
}
