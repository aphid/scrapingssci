var url = phantom.args[0];

var resp = {};
var page = require('webpage').create();
var HDS = function (url) {
    var start = new Date().getTime() / 1000;
    //nothing is true, everything is false! ok, but we need autoplay to be true.
    url = url.replace("'", "").replace("false", "true");
    return new Promise(function (resolve) {
        var data = {};
        page.settings.userAgent = 'Windows / Chrome 34: Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/34.0.1847.137 Safari/537.36';
        page.open(url, function () { // executed after loading
            //console.log("<<<<<<");
        }).then(function () {
            if (page.content.includes("Denied")) {

                page.render(dir + filename + ".denied.png");

                response = {
                    status: "denied",
                    filename: filename + ".denied.png"
                };
                //data.content = page.content;
                //console.log('{"status": "denied"}');
                console.log(JSON.stringify(response));
                slimer.exit();

            }
        });
        page.onResourceReceived = function (response) {
            var current = new Date().getTime() / 1000;
            if (current - start > 45) {
                resp.status = "fail";
                console.log(JSON.stringify(resp));
                slimer.exit();
            }

            if (response.url.contains('flv')) {
                data.type = "flv";
                data.src = response.url;
                page.close();
                resolve(data);
            } else if (response.url.contains('mp4?v') && response.status === 200) {
                data.type = "mp4";
                data.src = response.url;
                page.close();
                resolve(data);
            }
            if (response.status === 200 && (response.url.contains('manifest')) && (!response.url.contains('gif'))) {
                //console.log(">>>>>>>>>>  " + response.status);
                url = response.url;
                //console.log(url);
                data.type = "hds";
                data.manifest = url;
            }
            if (response.status === 200 && response.url.contains('Frag')) {
                data.auth = response.url.split('?').pop();

            }
            if (data.auth && data.manifest) {
                page.close();
                resolve(data);
            }
        };
    });

};
HDS(url).then(function (resolve) {
    console.log(JSON.stringify(resolve));
    slimer.exit();
}).catch(function (reason) {
    console.log(JSON.stringify(reason));
    slimer.exit();
});