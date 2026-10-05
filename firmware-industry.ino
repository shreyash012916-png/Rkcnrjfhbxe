#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
WebServer server(80);
const int MACHINE_PIN = 26;
bool machine = false;

void cors() { server.sendHeader("Access-Control-Allow-Origin", "*"); }
void status() {
  cors();
  StaticJsonDocument<420> d;
  d["online"] = true;
  d["machine"] = machine;
  d["temperature"] = 31.0;
  d["vibration"] = 0.08;
  d["load"] = 42;
  d["camera"] = true; // Set this false until your ESP32-CAM stream endpoint is ready.
  JsonArray available = d["available"].to<JsonArray>();
  available.add("ESP32"); available.add("ESP32-CAM"); available.add("machine relay"); available.add("camera feed"); available.add("load telemetry");
  String out; serializeJson(d, out); server.send(200, "application/json", out);
}

void setMachine() {
  cors();
  StaticJsonDocument<96> d; deserializeJson(d, server.arg("plain"));
  machine = d["on"] | false;
  digitalWrite(MACHINE_PIN, machine ? HIGH : LOW);
  server.send(200, "application/json", "{\"ok\":true}");
}
void stopMachine() { cors(); machine = false; digitalWrite(MACHINE_PIN, LOW); server.send(200, "application/json", "{\"ok\":true}"); }
void options() { cors(); server.send(204); }

void setup() {
  pinMode(MACHINE_PIN, OUTPUT); digitalWrite(MACHINE_PIN, LOW);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
  server.on("/api/status", HTTP_GET, status);
  server.on("/api/machine", HTTP_OPTIONS, options); server.on("/api/machine", HTTP_POST, setMachine);
  server.on("/api/stop", HTTP_OPTIONS, options); server.on("/api/stop", HTTP_POST, stopMachine);
  server.enableCORS(true); server.begin();
}

void loop() { server.handleClient(); }
