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

function JSONataQuery(query, data) {
    let value = undefined;
    if (query !== null) {
        // Query Result
        try {
            value = jsonata(query).evaluate(data);
        }
        catch (error) {

        }
    }
    return value;
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
    this.batteryQuery       = config["batteryQuery"] || null;
    this.batteryLow         = config["batteryLow"] || 20;
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

                // Battery
                let battery = JSONataQuery(this.batteryQuery, res.body);
                if (battery !== undefined) {
                    this.batteryService.setCharacteristic(Characteristic.BatteryLevel, battery);
                    this.batteryService.setCharacteristic(Characteristic.StatusLowBattery, battery <= this.batteryLow ? 1 : 0);
                }

                // Temperature
                let temperature = JSONataQuery(this.temperatureQuery, res.body);
                if (temperature !== undefined) {
                    this.temperatureService.setCharacteristic(Characteristic.CurrentTemperature, temperature);
                }

                // Humidity
                let humidity = JSONataQuery(this.humidityQuery, res.body);
                if (humidity !== undefined) {
                    this.humidityService.setCharacteristic(Characteristic.CurrentRelativeHumidity, humidity);
                }

                this.lastUpdateAt = +Date.now();

                switch (service) {
                    case "battery":
                        callback(null, battery);
                        break;
                    case "batteryLow":
                        callback(null, battery <= this.batteryLow ? 1 : 0);
                        break;
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

    getBatteryLowState: function(callback) {
        this.getRemoteState("batteryLow", callback);
    },

    getBatteryState: function(callback) {
        this.getRemoteState("battery", callback);
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

        // Battery
        if (this.batteryQuery !== null) {
            this.batteryService = new Service.BatteryService(this.name);
            this.batteryService.getCharacteristic(Characteristic.ChargingState).updateValue(2)
            this.batteryService.getCharacteristic(Characteristic.StatusLowBattery).on("get", this.getBatteryLowState.bind(this));
            this.batteryService.getCharacteristic(Characteristic.BatteryLevel).on("get", this.getBatteryState.bind(this));
            services.push(this.batteryService);
        }

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
