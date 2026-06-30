import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateEndpoint } from "../../src/observability/exporters/otlp-exporter.ts";

describe("OTLP SSRF endpoint validation", () => {
	it("allows valid public https URL", () => {
		assert.doesNotThrow(() => validateEndpoint("https://otlp.example.com:4318/v1/metrics"));
	});

	it("allows valid public http URL", () => {
		assert.doesNotThrow(() => validateEndpoint("http://collector.mycompany.io/v1/metrics"));
	});

	it("rejects localhost", () => {
		assert.throws(() => validateEndpoint("http://localhost:4318/v1/metrics"), /localhost/);
	});

	it("rejects .localhost subdomain", () => {
		assert.throws(() => validateEndpoint("http://app.localhost:4318"), /localhost/);
	});

	it("rejects 127.0.0.1 (loopback)", () => {
		assert.throws(() => validateEndpoint("http://127.0.0.1:4318"), /loopback/);
	});

	it("rejects 127.x.x.x (loopback range)", () => {
		assert.throws(() => validateEndpoint("http://127.0.0.2:4318"), /loopback/);
	});

	it("rejects 10.x.x.x (private class A)", () => {
		assert.throws(() => validateEndpoint("http://10.0.0.1:4318"), /private network/);
	});

	it("rejects 172.16.x.x (private class B start)", () => {
		assert.throws(() => validateEndpoint("http://172.16.0.1:4318"), /private network/);
	});

	it("rejects 172.31.x.x (private class B end)", () => {
		assert.throws(() => validateEndpoint("http://172.31.255.255:4318"), /private network/);
	});

	it("rejects 192.168.x.x (private class C)", () => {
		assert.throws(() => validateEndpoint("http://192.168.1.1:4318"), /private network/);
	});

	it("rejects 169.254.169.254 (AWS metadata)", () => {
		assert.throws(() => validateEndpoint("http://169.254.169.254/latest/meta-data/"), /link-local|metadata/);
	});

	it("rejects 169.254.x.x (link-local)", () => {
		assert.throws(() => validateEndpoint("http://169.254.1.1:4318"), /link-local|metadata/);
	});

	it("rejects 0.0.0.0 (this network)", () => {
		assert.throws(() => validateEndpoint("http://0.0.0.0:4318"), /this-network/);
	});

	it("rejects file:// protocol", () => {
		assert.throws(() => validateEndpoint("file:///etc/passwd"), /protocol/);
	});

	it("rejects javascript:// protocol", () => {
		assert.throws(() => validateEndpoint("javascript://alert(1)"), /protocol/);
	});

	it("rejects ftp:// protocol", () => {
		assert.throws(() => validateEndpoint("ftp://collector.example.com"), /protocol/);
	});

	it("rejects IPv6 loopback [::1]", () => {
		assert.throws(() => validateEndpoint("http://[::1]:4318"), /loopback/);
	});

	it("rejects IPv6 private fd00::/8", () => {
		assert.throws(() => validateEndpoint("http://[fd00::1]:4318"), /private IPv6/);
	});

	it("rejects IPv6 private fc00::/8", () => {
		assert.throws(() => validateEndpoint("http://[fc00::1]:4318"), /private IPv6/);
	});

	it("allows public IPv4", () => {
		assert.doesNotThrow(() => validateEndpoint("http://8.8.8.8:4318"));
	});

	it("allows 172.15.x.x (not in private range)", () => {
		assert.doesNotThrow(() => validateEndpoint("http://172.15.0.1:4318"));
	});

	it("allows 172.32.x.x (not in private range)", () => {
		assert.doesNotThrow(() => validateEndpoint("http://172.32.0.1:4318"));
	});

	it("rejects invalid URL", () => {
		assert.throws(() => validateEndpoint("not-a-url"), /Invalid OTLP endpoint/);
	});
});
