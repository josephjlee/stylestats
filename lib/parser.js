const fs = require('fs');
const url = require('url');
const path = require('path');
const css = require('css');
const request = require('request');
const cheerio = require('cheerio');
const util = require('./util');

/**
 * Get promised request
 * @param {Object} options
 * @returns {Promise}
 */
function requestPromise(options) {
  return new Promise((resolve, reject) => {
    request(options, (error, response) => {
      if (!error && response.statusCode === 200) {
        resolve(response);
      } else if (error) {
        reject(error);
      } else {
        reject(new Error(`Status code is ${response.statusCode}`));
      }
    });
  });
}

class Parser {
  /**
   * @param {Array} urls
   * @param {Array} files
   * @param {Array} styles
   */
  constructor(urls, files, styles, options) {
    this.urls = urls;
    this.files = files;
    this.styles = styles;
    this.options = options;

    this.cssFiles = [];

    this.files.forEach(function (file) {
      const extname = path.extname(file);
      switch (extname) {
        case '.css':
          this.cssFiles.push(file);
          break;
        default:
          break;
      }
    }, this);
  }

  /**
   * Parse css data
   * @returns {Promise}
   */
  parse() {
    // Object to return
    const parsedData = {
      cssString: '',
      cssSize: 0,
      styleElements: 0,
      mediaQueries: 0,
      cssFiles: 0,
      rules: [],
      selectors: [],
      declarations: []
    };

    const that = this;

    // Remote file requests
    const requestPromises = [];
    this.urls.forEach(url => {
      const options = that.options.requestOptions;
      options.url = url;
      options.gzip = true;
      requestPromises.push(requestPromise(options));
    });

    // CSS string array from arguments
    // They will be joined into css string
    this.cssFiles.forEach(cssFile => {
      // Push local css data
      that.styles.push(fs.readFileSync(cssFile, {
        encoding: 'utf8'
      }));
    });

    return new Promise((resolve, reject) => {
      // Get remote files
      Promise.all(requestPromises).then(results => {
        if (that.urls.length > 0 && that.files.length > 0 && that.styles.length > 0) {
          throw new Error('Argument is invalid');
        }

        // Requests to stylesheet defined in html
        const requestPromisesInner = [];

        results.forEach(result => {
          if (util.isCSS(result)) {
            that.styles.push(result);
          } else {
            // Push remote css data
            const type = result.headers['content-type'];
            if (type.indexOf('html') > -1) {
              // Parse result body
              const $ = cheerio.load(result.body);
              const $link = $('link[rel=stylesheet]');
              const $style = $('style');

              // Add css file count
              parsedData.cssFiles += $link.length;
              parsedData.styleElements += $style.length;

              // Request link[href]
              $link.each(function () {
                const relativePath = $(this).attr('href');
                const absolutePath = url.resolve(result.request.href, relativePath);
                const options = that.options.requestOptions;
                options.url = absolutePath;
                requestPromisesInner.push(requestPromise(options));
              });

              // Add text in style tags
              $style.each(function () {
                that.styles.push($(this).text());
              });
            } else if (type.indexOf('css') === -1) {
              throw new Error('Content type is not HTML or CSS!');
            } else {
              parsedData.cssFiles += 1;
              that.styles.push(result.body);
            }
          }
        });

        if (requestPromisesInner.length > 0) {
          return Promise.all(requestPromisesInner);
        }
        return true;
      }).then(results => {
        if (Array.isArray(results)) {
          results.forEach(result => {
            that.styles.push(result.body);
          });
        }

        // Join all css string
        parsedData.cssString = that.styles.join('');
        parsedData.cssSize = Buffer.byteLength(parsedData.cssString, 'utf8');

        // Parse css string
        let rawRules = [];

        try {
          rawRules = css.parse(parsedData.cssString).stylesheet.rules;
        } catch (error) {
          throw new Error(error);
        }

        // Check number of rules
        if (rawRules[0] === undefined) {
          throw new Error('Rule is not found.');
        }

        // Add rules into result
        rawRules.forEach(rule => {
          if (rule.type === 'rule') {
            parsedData.rules.push(rule);
          } else if (rule.type === 'media') {
            parsedData.mediaQueries += 1;
            rule.rules.forEach(rule => {
              if (rule.type === 'rule') {
                parsedData.rules.push(rule);
              }
            });
          }
        });

        // Add selectors and declarations into result
        parsedData.rules.forEach(rule => {
          rule.selectors.forEach(selector => {
            parsedData.selectors.push(selector);
          });
          rule.declarations.forEach(declaration => {
            if (declaration.type === 'declaration') {
              parsedData.declarations.push(declaration);
            }
          });
        });
        resolve(parsedData);
      }).catch(error => reject(error));
    });
  }
}

module.exports = Parser;
