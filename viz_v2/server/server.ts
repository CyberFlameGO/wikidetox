/*
Copyright 2019 Google Inc.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import express = require('express');
import * as bodyParser from 'body-parser';
import * as path from 'path';

import { BigQueryData } from './bigQuery';
import { WikiBot } from './wikiBot';

const googleapis = require('googleapis');

interface IConfig {
    gcloudAPIKey: string;
    gcloudKeyFilePath: string;
    bigQuery: {
        projectId: string;
        datasetID: string;
        dataTable: string;
    },
    wikiBot: {
        protocol: string;
        server: string;
        path: string;
        debug: boolean;
        username: string;
        userAgent: string;
        password: string;
    },
    port: number
}

const COMMENT_ANALYZER_DISCOVERY_URL =
    'https://commentanalyzer.googleapis.com/$discovery/rest?version=v1alpha1';

export class Server {
    public app: express.Express;
    public bigQuery: any;
    public wikiBot: any
    public analyzeApiClient: any;

    constructor (public config: IConfig) {
        this.bigQuery = new BigQueryData(config);
        this.wikiBot = new WikiBot(config.wikiBot);
        this.config = config;

        this.app = express();
        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({
            extended: true,
        }));

        const publicDir = path.join(__dirname, 'static');
        this.app.use(express.static(publicDir));

        this.app.get('/', (req, res) => {
            res.sendFile(path.resolve('static/index.html'), { root: __dirname });
        });

        this.app.post('/monthsdata', async (req, res) => {
            const startDate = req.body.st || '2018-06-01';
            const endDate = req.body.end || '2018-07-01';
            try {
                const query = this.bigQuery.monthDataQuery(startDate, endDate);
                const rows = await this.bigQuery.queryTable(query);
                console.log(`sending ${rows.length} rows`);
                res.send(rows);
            } catch (err) {
                console.error(err);
                res.status(403).send(err);
            }
        });

        this.app.post('/dailytrends', async (req, res) => {
            const startDate = req.body.st || '2018-06-01';
            const endDate = req.body.end || '2018-07-01';
            try {
                const query = this.bigQuery.dailyTimelineQuery(startDate, endDate);
                const rows = await this.bigQuery.queryTable(query);
                console.log(`sending ${rows.length} rows for daily trends`);
                res.send(rows);
            } catch (err) {
                console.error(err);
                res.status(403).send(err);
            }
        });

        this.app.post('/monthlytrends', async (req, res) => {
            const startDate = req.body.st || '2017-01-01';
            try {
                const query = this.bigQuery.getMonthTimeline(startDate);
                const rows = await this.bigQuery.queryTable(query);
                console.log(`sending ${rows.length} rows for monthly trends`);
                res.send(rows);
            } catch (err) {
                console.error(err);
                res.send(403).send(err);
            }
        });

        this.app.post('/wiki_revid', async (req, res) => {
            const pageid = req.body.pageid;
            try {
                const revid = await this.wikiBot.getRevisionID(pageid);
                res.send(`${revid}`);
            } catch (err) {
                console.error(err);
                res.status(403).send(err);
            }
        });

        this.app.post('/suggest_score', (req, res) => {
            if(!req.body) {
              // TODO: don't thow error, return an appropriate response code.
              throw Error('No feedback request body.');
            }
            const requestData = req.body;
            let attributeScores = {};
            attributeScores['TOXICITY'] = {
              summaryScore: { value: 0 }
            };

            let request = {
              comment: {text: requestData.comment},
              attribute_scores: attributeScores,
              client_token: 'WikiDetox_vis'
            };

            this.sendSuggestCommentScoreRequest(request)
              .then((response) => {
                console.log(response);
                res.send(response);
              })
              .catch((e) => {
                console.log(e)
                res.status(e.code).send(e);
              });
        });
    }

    public start(): Promise<null> {
        return new Promise((resolve, reject) => {
            const port = process.env.PORT || this.config.port;
            this.app.listen(port, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`App listening on port ${port}`);
                    resolve(null);
                }
            });
        });
    }

    private sendSuggestCommentScoreRequest(request): Promise<Object> {
        return new Promise((resolve, reject) => {
            this.analyzeApiClient.comments.suggestscore({
                key: this.config.gcloudAPIKey,
                resource: request
            },
            (error: Error, response) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(response);
            });
        });
    }

    public startClient(): Promise<void> {
        return new Promise<void>((resolve: () => void,
                                  reject: () => void) => {
            googleapis.discoverAPI(COMMENT_ANALYZER_DISCOVERY_URL, (discoverErr, client) => {
                if (discoverErr) {
                    console.error('ERROR: discoverAPI failed.');
                    reject();
                    return;
                }
                if (!(client.comments.suggestscore)) {
                    console.error(
                        'ERROR: !(client.comments.suggestscore) in analyze API');
                    reject();
                    return;
                }
                this.analyzeApiClient = client;
                resolve();
            });
        });
    };
}
