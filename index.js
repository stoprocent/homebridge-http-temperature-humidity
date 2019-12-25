var Service, Characteristic;
const request = require("superagent");
const jsonata = require("jsonata");
const fs = require('fs');

// Require and instantiate a cache module
const cacheModule = require("cache-service-cache-module");
const cache = new cacheModule({storage: "session", defaultExpiration: 60});

// Require superagent-cache-plugin and pass your cache module
const superagentCache = require("superagent-cache-plugin")(cache);

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-http-temperature-humidity", "HTTPTempHum", HTTPTempHum);
}

function HTTPTempHum(log, config) {
    this.log = log;

    // Configuration
    this.url                = config["url"];
    this.method             = config["method"] || "GET";
    this.name               = config["name"];
    this.manufacturer       = config["manufacturer"] || "Generic";
    this.model              = config["model"] || "Sensor";
    this.serial             = config["serial"] || "";
    this.humidityQuery      = config["humidityQuery"] || null;
    this.temperatureQuery   = config["temperatureQuery"] || null;
    this.lastUpdateAt       = config["lastUpdateAt"] || null;
    this.cacheExpiration    = config["cacheExpiration"] || 60;
    this.certificateCA      = config["certificateCA"] !== undefined ? fs.readFileSync(config["certificateCA"]) : null;
}

HTTPTempHum.prototype = {

    getRemoteState: function(service, callback) {
        request(this.method, this.url)
          .ca(this.certificateCA)
          .set("Accept", "application/json")
          .use(superagentCache)
          .expiration(this.cacheExpiration)
          .end(function(err, res, key) {
            if (err) {
                this.log(`HTTP failure (${this.url})`);
                callback(err);
            } else {
                this.log(`HTTP success (${key})`);
                // Temperature
                let temperature;
                if (this.temperatureQuery !== null) {
                    // Query Result
                    try {
                        temperature = jsonata(this.temperatureQuery).evaluate(res.body);
                    }
                    catch (error) {
                        callback(error);
                        return;
                    }

                    this.temperatureService.setCharacteristic(
                        Characteristic.CurrentTemperature,
                        temperature
                    );
                }

                // Humidity
                let humidity;
                if (this.humidityQuery !== null) {
                    // Query Result
                    try {
                        humidity = jsonata(this.humidityQuery).evaluate(res.body);
                    }
                    catch (error) {
                        callback(error);
                        return;
                    }

                    this.humidityService.setCharacteristic(
                        Characteristic.CurrentRelativeHumidity,
                        humidity
                    );
                }

                this.lastUpdateAt = +Date.now();

                switch (service) {
                    case "temperature":
                        callback(null, temperature);
                        break;
                    case "humidity":
                        callback(null, humidity);
                        break;
                    default:
                        var error = new Error("Unknown service: " + service);
                        callback(error);
                }
            }
        }.bind(this));
    },

    getTemperatureState: function(callback) {
        this.getRemoteState("temperature", callback);
    },

    getHumidityState: function(callback) {
        this.getRemoteState("humidity", callback);
    },

    getServices: function () {
        var services = [],
            informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
            .setCharacteristic(Characteristic.Model, this.model)
            .setCharacteristic(Characteristic.SerialNumber, this.serial);
        services.push(informationService);

        // Temperature
        if (this.temperatureQuery !== null) {
            this.temperatureService = new Service.TemperatureSensor(this.name);
            this.temperatureService
                .getCharacteristic(Characteristic.CurrentTemperature)
                .setProps({ minValue: -273, maxValue: 200 })
                .on("get", this.getTemperatureState.bind(this));
            services.push(this.temperatureService);
        }
        
        // Humidity
        if (this.humidityQuery !== null) {
            this.humidityService = new Service.HumiditySensor(this.name);
            this.humidityService
                .getCharacteristic(Characteristic.CurrentRelativeHumidity)
                .setProps({ minValue: 0, maxValue: 100 })
                .on("get", this.getHumidityState.bind(this));
            services.push(this.humidityService);
        }

        return services;
    }
};
