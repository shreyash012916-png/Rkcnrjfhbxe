#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
WebServer server(80);

const int PUMP_PIN = 26;
const int SOIL_PIN = 34;
bool pump = false;
bool autoMode = true;
const int DRY_ON = 35;
const int WET_OFF = 55;

int soilPercent() {
  int raw = analogRead(SOIL_PIN);
  int soil = map(raw, 4095, 1200, 0, 100);
  return constrain(soil, 0, 100);
}

void cors() { server.sendHeader("Access-Control-Allow-Origin", "*"); }
void status() {
  cors();
  StaticJsonDocument<420> d;
  d["online"] = true;
  d["soil"] = soilPercent();
  d["pump"] = pump;
  d["auto"] = autoMode;
  d["waterTank"] = 86;
  d["temperature"] = 27.0;
  d["humidity"] = 60;
  JsonArray available = d["available"].to<JsonArray>();
  available.add("ESP32"); available.add("soil moisture sensor"); available.add("water pump"); available.add("automatic irrigation");
  String out; serializeJson(d, out); server.send(200, "application/json", out);
}

void setPump() {
  cors();
  StaticJsonDocument<96> d; deserializeJson(d, server.arg("plain"));
  pump = d["on"] | false;
  digitalWrite(PUMP_PIN, pump ? HIGH : LOW);
  server.send(200, "application/json", "{\"ok\":true}");
}

void setAuto() {
  cors();
  StaticJsonDocument<96> d; deserializeJson(d, server.arg("plain"));
  autoMode = d["enabled"] | false;
  server.send(200, "application/json", "{\"ok\":true}");
}

void options() { cors(); server.send(204); }

void setup() {
  pinMode(PUMP_PIN, OUTPUT); digitalWrite(PUMP_PIN, LOW);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
  server.on("/api/status", HTTP_GET, status);
  server.on("/api/pump", HTTP_OPTIONS, options); server.on("/api/pump", HTTP_POST, setPump);
  server.on("/api/auto", HTTP_OPTIONS, options); server.on("/api/auto", HTTP_POST, setAuto);
  server.enableCORS(true); server.begin();
}

void loop() {
  server.handleClient();
  if (autoMode) {
    int soil = soilPercent();
    if (soil < DRY_ON && !pump) { pump = true; digitalWrite(PUMP_PIN, HIGH); }
    if (soil > WET_OFF && pump) { pump = false; digitalWrite(PUMP_PIN, LOW); }
  }
}
