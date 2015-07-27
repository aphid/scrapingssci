var request = require('request');
var cheerio = require('cheerio');
var moment = require('moment');
var Url = require('url');
var fs = require('graceful-fs');
var pfs = require('fs-promise');
var path = require('path');
var exif = require('exiftool');
var pdftotext = require('pdftotextjs')
var http = require('http');
var cpp = require('child-process-promise').cpp;
var slimerjs = require('slimerjs');
var binPath = slimerjs.path;

//paths should have trailing slash 
var scraper = {
  dataDir: './data/',
  hearingDir: './data/hearings/',
  textDir: './media/text/',
  videoDir: './media/video/',
  sockets: 5,
  current: 0,
  queue: [],
  busy: false
};


var Video = function (options) {
  for (var fld in options) {
    if (options[fld]) {
      this[fld] = options[fld];
    }
  }

  return this;
};


Video.prototype.getManifest = function () {
  var vid = this;
  console.log("getting manifest!");
  return new Promise(function (fulfill, reject) {

    var childArgs = [binPath, path.join(__dirname, 'getManifest.js'), vid.url];
    cpp.exec('/usr/bin/xvfb-run', childArgs).then(function (result) {
        var response = JSON.parse(result.stdout);
        if (response.type) {
          vid.type = response.type
        }
        fulfill(JSON.parse(result.stdout));
      })
      .fail(function (err) {
        reject(err);
      });

  });
};

Video.getHDS = function (data) {

  return new Promise(function (fulfill, reject) {

    var manifest = data.manifest;
    var auth = data.auth;
  });
};

var Committee = function (options) {
  for (var fld in options) {
    if (options[fld]) {
      this[fld] = options[fld];
    }
  }
  this.hearings = [];
  this.meta = [];
  return this;
};


var Witness = function (options) {
  for (var fld in options) {
    if (options[fld]) {
      this[fld] = options[fld];
    }
  }
  if (!options.pdfs) {
    this.pdfs = [];
  }
};


Committee.prototype.addHearing = function (options) {
  var hearing = new Hearing(options);
  for (var hear of this.hearings) {
    if (hear.date === options.date) {
      console.log("likely dupe");
      return false;
    }
  }
  this.hearings.push(hearing);
  return hearing;
};


Committee.prototype.scrapeRemote = function () {
  var comm = this;
  var pages = [];

  return new Promise(function (fulfill, reject) {
    comm.getHearingIndex(comm.hearingIndex).then(function (resolve) {
      if (resolve) {
        for (var i = 1; i <= resolve.lastPage; i++) {
          var page = 'http://www.intelligence.senate.gov/hearings/open?keys=&cnum=All&page=' + i;
          pages.push(page);
          console.log(pages);
        }
      }

    }).then(function () {
      return comm.getPages(pages);
    }).then(function () {
      return comm.fetchAll();
    }).then(function () {
      fulfill();
    });
  });
};

Committee.prototype.init = function () {
  var comm = this;

  /*
  //gets from local file
  (function () {
    return comm.write('test.json');
  }); */

  comm.readLocal().
    //this.scrapeRemote().
  then(function () {
      return comm.write();
    }).then(function () {
      console.log("PDF time");
      return Promise.all(comm.hearings.map(function (a) {
        return a.queuePdfs();
      }));
    }).then(function () {
      console.log("we have all the text... now video!!");
      return comm.hearings[0].video.getManifest();
    }).then(function (result) {
      return comm.hearings[0].video.getHDS(result);
      return comm.write();
    })
    .catch(function () {
      console.log("something terrible happened");

    });

};

Committee.prototype.readLocal = function () {
  var comm = this;
  return new Promise(function (fulfill, reject) {

    var json = scraper.dataDir + "data.json";
    pfs.readFile(json, 'utf-8').then(function (data) {
      data = JSON.parse(data);
      for (var hear of data.hearings) {
        var theHearing = new Hearing(hear);
        theHearing.witnesses = [];
        if (hear.video) {
          theHearing.addVideo(JSON.parse(JSON.stringify(hear.video)));
        }
        for (var wit of hear.witnesses) {
          var theWit = new Witness(JSON.parse(JSON.stringify(wit)));
          theWit.pdfs = [];
          if (wit.pdfs) {
            console.log("adding PDFS");

            for (var pdf of wit.pdfs) {
              console.log(wit.pdfs.length);
              theWit.readPdf(pdf);
            }
            theHearing.addWitness(theWit);
          }
        }
        comm.addHearing(theHearing);

      }
      fulfill();
    });
  });
};


Committee.prototype.write = function (filename) {
  if (!filename) {
    filename = "data.json";
  }
  var comm = this;
  return new Promise(function (fulfill, reject) {
    var json = JSON.stringify(comm, undefined, 2);
    pfs.writeFile((scraper.dataDir + filename), json).then(function (err) {
      if (err) reject(err);
      console.log("><><><><><><><><>The file was saved!");
      fulfill();
    });
  });
};


var Witness = function (options) {
  for (var fld in options) {
    if (options[fld]) {
      this[fld] = options[fld];
    }
  }
  if (!options.pdfs) {
    this.pdfs = [];
  }
};

var Hearing = function (options) {
  for (var fld in options) {
    if (options[fld]) {
      this[fld] = options[fld];
    }
  }

  if (!options.vidUrl) {
    this.witnesses = "";
  }
  if (!options.witnesses) {
    this.witnesses = [];
  }

  this.shortdate = moment(new Date(this.date)).format("YYMMDD");
};

Hearing.prototype.addVideo = function (video) {
  this.video = new Video(JSON.parse(JSON.stringify(video)));
};

var Pdf = function (options) {
  if (options.hear && options.url) {
    var hear = options.hear;
    var url = options.url;
    this.remoteUrl = url;
    this.remotefileName = decodeURIComponent(scraper.textDir + path.basename(Url.parse(url).pathname)).split('/').pop();
    this.pdfpath = scraper.textDir + hear.shortdate + "_" + this.remotefileName;
    this.txtpath = this.pdfpath.replace(".pdf", ".txt");
    this.metapath = this.pdfpath.replace(".pdf", ".json");
  } else {
    for (var fld in options) {
      if (options[fld]) {
        this[fld] = options[fld];
      }
    }
  }
}


scraper.getFile = function (url, dest) {
  return new Promise(function (fulfill, reject) {
    pfs.access(dest).then(function () {
      //file exists
      var size = fs.statSync(dest).size;
      console.log(dest + " exists (" + size + ")");
      if (size) {
        console.log("file's okay");
        fulfill();
      } else {
        //validate media here?
        console.log('exists but zero bytes, refetching');
        fs.unlinkSync(dest);
        var file = fs.createWriteStream(dest);
        http.get(url, function (response) {
          console.log("fetching " + url);
          response.pipe(file);
          file.on('finish', function () {
            file.close();
            fulfill();
          });
        });


      }
    }).catch(function () {
      console.log("reject - file " + dest + " doesn't exist");
      //file does not exist, well we should parse err but nope
      var file = fs.createWriteStream(dest);
      http.get(url, function (response) {
        console.log("fetching " + url);
        response.pipe(file);
        file.on('finish', function () {
          file.close();
          console.log("done writing " + fs.statSync(dest).size + "bytes");
          fulfill();
        });
      });

    });

  });
};


scraper.getMeta = function (dest) {
  return new Promise(function (fulfill, reject) {
    var jsonpath = dest + ".json";
    pfs.access(jsonpath).then(function () {
      var msize = fs.statSync(jsonpath).size;
      console.log(jsonpath + " exists! (" + msize + ")");
      if (msize) {
        console.log("meta's already here, moving on");
        fulfill();
      } else {
        console.log("Deleting zero size item");
        fs.unlinkSync(jsonpath);
      }
    }).catch(function () {
      console.log("creating metadata...");

      fs.readFile(dest, function (err, data) {
        if (err) {
          console.log("error reading metadata");
          reject(err);
        }
        exif.metadata(data, function (err, metadata) {
          if (err) {
            throw "exiftool error: " + err;
          } else {
            //var json = JSON.stringify(metadata, undefined, 2);
            pfs.writeFile(jsonpath, JSON.stringify(metadata, undefined, 2)).then(function () {
              fulfill();
            });

          }
        }); //end metadata

      }); //end readfile
    });
  }); //end promise

};

Pdf.prototype.checkTxt = function () {
  var pdf = this;
  var dest = this.pdfpath;
  var txtpath = this.txtpath;

  return new Promise(function (reject, fulfill) {

    pfs.access(txtpath).then(function (stuff) {
      var msize = fs.statSync(txtpath).size;
      console.log(txtpath + " exists! (" + msize + ")");
      if (msize) {
        console.log("txt's already here, moving on");
        fulfill();
      } else {
        console.log("Deleting zero size item");
        fs.unlinkSync(txtpath);
      }
    }).catch(function () {
      var pdftxt = new pdftotext(dest);
      pdftxt.getText(function (err, data, cmd) {
        console.log("TEXTIFYING: " + dest);
        if (err) throw err;
        if (!data) {
          console.error("NO DATA");
          pdf.needsScan = true;
          fulfill();
        } else {
          console.log("DATA");
          fs.writeFile((dest + ".txt"), data, function (err) {
            console.log('writing file');
            if (err) {
              throw err;
            }
            console.log('fulfilling textify');
            fulfill();
          });
          // additionally you can also access cmd array
          // it contains params which passed to pdftotext ['filename', '-f', '1', '-l', '1', '-']
          //console.log(cmd.join(' '));
        }
      });
    });
  });
};

Hearing.prototype.queuePdfs = function () {
  console.log(this.title + "pdfs: ");
  var pdfs = [];
  for (var wit of this.witnesses) {
    if (wit.pdfs) {
      for (var pdf of wit.pdfs) {
        console.log(" " + pdf.remotefileName);
        pdfs.push(pdf);
      }
    }
  }

  return Promise.all(pdfs.map(function (a) {
    return a.process();
  }));
};

Pdf.prototype.process = function () {
  var pdf = this;
  return new Promise(function (fulfill, reject) {
    var dest = pdf.pdfpath;
    scraper.getFile(pdf.remoteUrl, dest).then(function () {
      return scraper.getMeta(dest);
    }).then(function () {
      console.log("textifying");
      return pdf.textify(dest);
    }).then(function () {
      console.log('done with ' + dest);
      //scraper.workQueue();
      fulfill();

    }).catch(function () {
      console.log("it's okay");
      fulfill();
      //scraper.workQueue();
    });
  });


};


Hearing.prototype.addWitness = function (witness) {
  console.log("adding " + witness.lastName);
  if (!witness.isPrototypeOf(Witness)) {
    var wit = new Witness(witness);
    this.witnesses.push(wit);
    return wit;
  } else {

    this.witnesses.push(witness);
    return witness;
  }

};


//from scrape
Witness.prototype.addPdf = function (hear, url) {
  for (var pdf of this.pdfs) {
    if (url === pdf.remoteUrl) {
      console.log('blocking duplicate');
      return false;
    }
  }
  var thepdf = new Pdf({
    "hear": hear,
    "url": url
  });
  this.pdfs.push(thepdf);


};

//from file
Witness.prototype.readPdf = function (options) {
  var pdf = new Pdf(options);
  this.pdfs.push(pdf);
  return pdf;
};



Committee.prototype.getPages = function (pages) {
  var comm = this;
  return Promise.all(pages.map(function (a) {
    return comm.getHearingIndex(a);
  }));
};

Committee.prototype.fetchAll = function () {
  var comm = this;
  return Promise.all(comm.hearings.map(function (a) {
    return a.fetch();
  }));

};

Committee.prototype.getHearingIndex = function (url) {
  var comm = this;
  var lastPage;
  return new Promise(function (fulfill, reject) {

    console.log("trying " + url);
    request(url, function (error, response, html) {
      if (error) throw error;

      if (!error && response.statusCode == 200) {
        var $ = cheerio.load(html);
        var pagerLast = $('.pager-last a').attr('href');
        if (pagerLast) {
          lastPage = Url.parse(pagerLast, true);
        }
        //console.log(lastPage.query.page);
        $('.views-row').each(function (i, elem) {
          var hearing = {};
          hearing.dcDate = $(elem).find('.date-display-single').attr('content');
          hearing.hearingPage = "" + $(elem).find('.views-field-field-hearing-video').find('a').attr('href');
          hearing.hearingPage = Url.resolve("http://www.intelligence.senate.gov/", hearing.hearingPage);
          hearing.title = $(elem).find('.views-field-title').text().trim();
          var datesplit = $(elem).find('.views-field-field-hearing-date').text().trim().split(' - ');
          hearing.date = datesplit[0];
          hearing.time = datesplit[1];
          comm.hearings.push(new Hearing(hearing));

        });

        if (lastPage) {

          fulfill({
            "lastPage": lastPage.query.page
          });
        } else {
          fulfill();
        }
      } else {
        console.log("BAD PAGE REQUEST");
        fulfill();

      }
    }); // end request
  }); // end promise

};



Hearing.prototype.fetch = function () {
  var hear = this;

  return new Promise(function (fulfill, reject) {
    console.log('starting a fetch');
    var panel;
    console.log("getting info for: " + hear.date);
    console.log(hear.hearingPage);
    request(hear.hearingPage, function (error, response, html) {
      if (error) {
        console.log(hear.hearingPage + " is throwing an error: " + error);
        reject(error);
      }
      if (response.statusCode === 200) {
        var $ = cheerio.load(html);
        hear.addVideo({
          url: decodeURIComponent($('.pane-node-field-hearing-video').find('iframe').attr('src'))
        });
        var wits = $('.pane-node-field-hearing-witness');
        if (wits.find('.pane-title').text().trim() === "Witnesses") {
          wits.find('.content').each(function (k, v) {
            if ($(v).find('.field-name-field-witness-panel').length) {
              panel = $(v).find('.field-name-field-witness-panel').text().trim().replace(':', '');
            }

            var witness = {};
            witness.firstName = $(v).find('.field-name-field-witness-firstname').text().trim();
            witness.lastName = $(v).find('.field-name-field-witness-lastname').text().trim();
            witness.title = $(v).find('.field-name-field-witness-job').text().trim();
            witness.org = $(v).find('.field-name-field-witness-organization').text().trim();
            witness.group = panel;
            var wit = new Witness(witness);
            if ($(v).find('li').length) {
              $(v).find('a').each(function (key, val) {
                var pdf = {};
                pdf.name = $(val).text();
                pdf.url = $(val).attr('href');
                if (!pdf.url.includes('http://')) {
                  pdf.url = intel.url + pdf.url;
                }
                wit.addPdf(hear, pdf.url);
              });
            }
            if (witness.firstName) {
              console.log("adding witness");
              hear.addWitness(wit);
            }
          }); //end each

        } // end if
        console.log("done with " + hear.title);

      } else {
        console.log("bad request on " + hear.hearingPage);
      } // end status

      fulfill();

    }); // end request

  }); //end promise
};



process.on('unhandledRejection', function (reason, p) {
  console.log("Unhandled Rejection at: Promise ", p, " reason: ", reason);
  // application specific logging, throwing an error, or other logic here
});


var intel = new Committee({
  committee: "Intelligence",
  chamber: "senate",
  url: "http://www.intelligence.senate.gov",
  hearingIndex: "http://www.intelligence.senate.gov/hearings/open",
  shortname: "intel"
});

intel.init();