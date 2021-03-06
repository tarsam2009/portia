ASTool.SpiderIndexController = Em.ObjectController.extend(ASTool.BaseControllerMixin,
	ASTool.DocumentViewDataSource, ASTool.DocumentViewListener, {

	queryParams: 'url',
	url: null,

	needs: ['application', 'project_index'],

	navigationLabelBinding: 'content.name',

	documentView: null,

	saving: false,

	newStartUrl: '',

	newExcludePattern: '',

	browseHistory: [],

	pageMap: {},

	loadedPageFp: null,

	autoloadTemplate: null,

	pendingFetches: [],

	itemDefinitions: null,

	extractedItems: [],

	testing: false,

	queryUrl: function() {
		if (!this.url) return;
		this.fetchQueryUrl();
	}.observes('url'),

	fetchQueryUrl: function() {
		url = this.url;
		this.set('url', null);
		Ember.run.next(this, function() {
			this.fetchPage(url, null, true);
		});
	},

	startUrlCount: function() {
		if (!Em.isEmpty(this.get('start_urls'))) {
			return this.get('start_urls').length;
		} else {
			return 0;
		}
	}.property('start_urls.[]'),

	hasStartUrl: function() {
		return !this.get('newStartUrl');
	}.property('newStartUrl'),

	hasExcludePattern: function() {
		return !this.get('newExcludePattern');
	}.property('newExcludePattern'),

	hasFollowPattern: function() {
		return !this.get('newFollowPattern');
	}.property('newFollowPattern'),

	displayEditPatterns: function() {
		return this.get('links_to_follow') == 'patterns';
	}.property('links_to_follow'),

	displayNofollow: function() {
		return this.get('links_to_follow') != 'none';
	}.property('model.links_to_follow'),

	_showLinks: false,

	showLinks: function(key, show) {
		if (arguments.length > 1) {
			if (show) {
				this.set('_showLinks', true);
			} else {
				this.set('_showLinks', false);
			}
		}
		return this.get('_showLinks');
	}.property('_showLinks'),

	showItems: true,

	addTemplateDisabled: function() {
		return !this.get('loadedPageFp');
	}.property('loadedPageFp'),

	browseBackDisabled: function() {
		return this.get('browseHistory').length <= 1;
	}.property('browseHistory.@each'),

	reloadDisabled: function() {
		return !this.get('loadedPageFp');
	}.property('loadedPageFp'),

	showItemsDisabled: function() {
		var loadedPageFp = this.get('loadedPageFp');
		if (this.extractedItems.length > 0) return false;
		if (this.pageMap[loadedPageFp] && this.pageMap[loadedPageFp].items) {
			return !loadedPageFp ? true : !this.pageMap[loadedPageFp].items.length;
		}
		return true;
	}.property('loadedPageFp', 'extractedItems'),

	showNoItemsExtracted: function() {
		return this.get('loadedPageFp') && Em.isEmpty(this.get('extractedItems')) && this.showItemsDisabled;
	}.property('loadedPageFp', 'showItemsDisabled'),

	itemsButtonLabel: function() {
		return this.get('showItems') ? "Hide Items " : "Show Items";
	}.property('showItems'),

	testButtonLabel: function() {
		if (this.get('testing')) {
			return "Stop testing";
		} else {
			return "Test spider";
		}
	}.property('testing'),

	links_to_follow: function(key, follow) {
		// The spider spec only supports 'patterns' or 'none' for the
		// 'links_to_follow' attribute; 'all' is only used for UI purposes.
		var model = this.get('model');
		var retVal = follow;
		if (arguments.length > 1) {
			if (follow != 'patterns') {
				model.get('exclude_patterns').setObjects([]);
				model.get('follow_patterns').setObjects([]);
			}
			model.set('links_to_follow', follow == 'none' ? 'none' : 'patterns');
		} else {
			retVal = model.get('links_to_follow');
			if (retVal == 'patterns' &&
				Em.isEmpty(model.get('follow_patterns')) &&
				Em.isEmpty(model.get('exclude_patterns'))) {
				retVal = 'all';
			}
		}
		return retVal;
	}.property('model.links_to_follow',
			   'model.follow_patterns',
			   'model.exclude_patterns'),

	spiderDomains: function() {
		var spiderDomains = new Set();
		this.get('content.start_urls').forEach(function(startUrl) {
			spiderDomains.add(URI.parse(startUrl)['hostname']);
		});
		return spiderDomains;
	}.property('content.start_urls.@each'),

	sprites: function() {
		if (!this.get('loadedPageFp') || !this.get('showLinks')) {
			return [];
		}
		var currentPageData = this.get('pageMap')[this.get('loadedPageFp')];
		var allLinks = $($('#scraped-doc-iframe').contents().get(0).links);
		var followedLinks = currentPageData.links;
		var sprites = [];
		allLinks.each(function(i, link) {
			var followed = followedLinks.indexOf(link.href) >= 0 &&
				this.get('spiderDomains').has(URI.parse(link.href)['hostname']);
			sprites.pushObject(ASTool.ElementSprite.create({
				element: link,
				hasShadow: false,
				fillColor: followed ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.3)',
				strokeColor: followed ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.3)' }));
		}.bind(this));
		return sprites;
	}.property('loadedPageFp', 'showLinks', 'spiderDomains'),

	currentUrl: function() {
		if (!Em.isEmpty(this.get('pendingFetches'))) {
			return 'Fetching page...';
		} else if (this.get('loadedPageFp')) {
			return this.get('pageMap')[this.get('loadedPageFp')].url;
		} else {
			return 'No page loaded';
		}
	}.property('loadedPageFp', 'pendingFetches.@each'),

	editTemplate: function(templateName) {
		this.transitionToRoute('template', templateName);
	},

	viewTemplate: function(templateName) {
		this.get('slyd').loadTemplate(this.get('name'), templateName).then(function(template) {
			var newWindow = window.open('about:blank',
				'_blank',
				'resizable=yes, scrollbars=yes');
			newWindow.document.write(template.get('annotated_body'));
			newWindow.document.title = ('Template ' + template.get('name'));
		}, function(err) {this.showHTTPAlert('Error Getting Template', err);}.bind(this));
	},

	wrapItem: function(item) {
		var itemDefinition = this.get('itemDefinitions').findBy('name', item['_type']);
		return ASTool.ExtractedItem.create({ extracted: item,
											 definition: itemDefinition,
											 matchedTemplate: item['_template_name'] });
	},

	updateExtractedItems: function(items) {
		var extractedItems = items.map(this.wrapItem, this);
		this.set('extractedItems', extractedItems);
	},

	fetchPage: function(url, parentFp, skipHistory) {
		this.set('loadedPageFp', null);
		var documentView = this.get('documentView');
		documentView.showLoading();
		var fetchId = ASTool.guid();
		this.get('pendingFetches').pushObject(fetchId);
		this.get('slyd').fetchDocument(url, this.get('content.name'), parentFp).
			then(function(data) {
				if (this.get('pendingFetches').indexOf(fetchId) == -1) {
					// This fetch has been cancelled.
					return;
				}
				if (!data.error && data.response.status == 200) {
					data.url = url;
					if (!skipHistory) {
						this.get('browseHistory').pushObject(data.fp);
					}
					documentView.displayDocument(data.page,
						function(docIframe){
							documentView.hideLoading();
							this.get('pendingFetches').removeObject(fetchId);
							this.get('documentView').reset();
							this.get('documentView').config({ mode: 'browse',
											  listener: this,
											  dataSource: this });
							this.set('loadedPageFp', data.fp);
							this.get('pageMap')[data.fp] = data;
							this.updateExtractedItems(data.items || []);
						}.bind(this)
					);
				} else {
					documentView.hideLoading();
					this.get('pendingFetches').removeObject(fetchId);
					documentView.showError(data.error || data.response.status);
				}
			}.bind(this), function(err) {this.showHTTPAlert('Fetch Error', err);}.bind(this)
		);
	},

	displayPage: function(fp) {
		this.set('loadedPageFp', null);
		var documentView = this.get('documentView');
		documentView.displayDocument(this.get('pageMap')[fp].page,
			function(){
				this.get('documentView').reset();
				this.get('documentView').config({ mode: 'browse',
					listener: this,
					dataSource: this });
				this.set('loadedPageFp', fp);
			}.bind(this));
	},

	addTemplate: function() {
		var page = this.get('pageMap')[this.get('loadedPageFp')];
		var template_name = ASTool.shortGuid();
		var template = ASTool.Template.create(
			{ name: template_name,
			  extractors: {},
			  annotations: {},
			  annotated_body: page.page,
			  original_body: page.original,
			  page_id: page.fp,
			  _new: true,
			  url: page.url });
		itemDefs = this.get('itemDefinitions');
		if (!itemDefs.findBy('name', 'default') && !Em.isEmpty(itemDefs)) {
			// The deault item doesn't exist but we have at least one item def.
			template.set('scrapes', itemDefs[0].get('name'));
		}
		this.get('content.template_names').pushObject(template_name);
		this.get('slyd').saveTemplate(this.get('name'), template).then(function() {
			this.saveSpider().then(
				function() {
					this.editTemplate(template_name);
				}.bind(this), function(err) {
					this.showHTTPAlert('Save Error', err);
				}.bind(this));
			}.bind(this), function(err) {
				this.showHTTPAlert('Save Error', err);
			}.bind(this)
		);
	},

	addStartUrls: function(urls) {
		urls.match(/[^\s,]+/g).forEach(function(url) {
			parsed = URI.parse(url);
			if (!parsed.protocol) {
				parsed.protocol = 'http';
				url = URI.build(parsed);
			}
			this.get('content.start_urls').pushObject(url);
		}.bind(this));
	},

	addExcludePattern: function(pattern) {
		this.get('content.exclude_patterns').pushObject(pattern);
	},

	deleteExcludePattern: function(pattern) {
		this.get('content.exclude_patterns').removeObject(pattern);
	},

	addFollowPattern: function(pattern) {
		this.get('content.follow_patterns').pushObject(pattern);
	},

	deleteFollowPattern: function(pattern) {
		this.get('content.follow_patterns').removeObject(pattern);
	},

	autoFetch: function() {
		if (this.get('loadedPageFp') && this.get('showLinks')) {
			this.saveSpider().then(function() {
				this.fetchPage(this.get('pageMap')[this.get('loadedPageFp')].url, null, true);
			}.bind(this));
		}
	}.observes('follow_patterns.@each',
			   'exclude_patterns.@each',
			   'links_to_follow'),

	attachAutoSave: function() {
		this.get('model').addObserver('dirty', function() {
			Ember.run.once(this, 'saveSpider');
		}.bind(this));
	}.observes('model'),

	saveSpider: function() {
		this.set('saving', true);
		return this.get('slyd').saveSpider(this.get('content')).then(function() {
			this.set('saving', false);
		}.bind(this),function(err) {
			this.set('saving', false);
			this.showHTTPAlert('Save Error', err);
		}.bind(this));
	},

	reset: function() {
		this.set('browseHistory', []);
		this.set('pageMap', {});
	}.observes('content'),

	testSpider: function(urls) {
		if (this.get('testing') && urls.length) {
			var fetchId = ASTool.guid();
			this.get('pendingFetches').pushObject(fetchId);
			this.get('slyd').fetchDocument(urls[0], this.get('content.name')).then(
				function(data) {
					if (this.get('pendingFetches').indexOf(fetchId) != -1) {
						this.get('pendingFetches').removeObject(fetchId);
						if (!Em.isEmpty(data.items)) {
							data.items.forEach(function(item) {
								this.get('extractedItems').pushObject(this.wrapItem(item));
							}, this);
						}
						this.testSpider(urls.splice(1));
					} else {
						this.set('testing', false);
					}
				}.bind(this),
				function(err) {
					this.showHTTPAlert('Fetch Error', err);
				}.bind(this)
			);
		} else {
			this.get('documentView').hideLoading();
			if (Em.isEmpty(this.get('extractedItems'))) {
				this.showAlert('Save Error',ASTool.Messages.get('no_items_extracted'));
			}
			this.set('testing', false);
		}
	},

	actions: {

		editTemplate: function(templateName) {
			this.editTemplate(templateName);
		},

		addTemplate: function() {
			this.addTemplate();
		},

		deleteTemplate: function(templateName) {
			this.get('content.template_names').removeObject(templateName);
			this.get('slyd').deleteTemplate(this.get('name'), templateName).then(
				function() { }, function(err) {
					this.showHTTPAlert('Delete Error', err);
				}.bind(this));
		},

		viewTemplate: function(templateName) {
			this.viewTemplate(templateName);
		},

		fetchPage: function(url) {
			// Cancel all pending fetches.
			this.get('pendingFetches').setObjects([]);
			this.fetchPage(url);
		},

		reload: function() {
			this.fetchPage(this.get('pageMap')[this.get('loadedPageFp')].url, null, true);
		},

		browseBack: function() {
			var history = this.get('browseHistory');
			history.removeAt(history.length - 1);
			var lastPageFp = history.get('lastObject');
			this.displayPage(lastPageFp);
		},

		addStartUrls: function() {
			this.addStartUrls(this.get('newStartUrl'));
			this.set('newStartUrl', '');
		},

		deleteStartUrl: function(url) {
			this.get('start_urls').removeObject(url);
		},

		addExcludePattern: function() {
			this.addExcludePattern(this.get('newExcludePattern'));
			this.set('newExcludePattern', '');
		},

		deleteExcludePattern: function(pattern) {
			this.deleteExcludePattern(pattern);
		},

		editExcludePattern: function(oldVal, newVal) {
			this.deleteExcludePattern(oldVal);
			this.addExcludePattern(newVal);
		},

		addFollowPattern: function() {
			this.addFollowPattern(this.get('newFollowPattern'));
			this.set('newFollowPattern', '');
		},

		deleteFollowPattern: function(pattern) {
			this.deleteFollowPattern(pattern);
		},

		editFollowPattern: function(oldVal, newVal) {
			this.deleteFollowPattern(oldVal);
			this.addFollowPattern(newVal);
		},

		toggleShowItems: function() {
			this.set('showItems', !this.get('showItems'));
		},

		rename: function(oldName, newName) {
			var spidersForProject = this.get('controllers.project_index.content');
			newName = this.getUnusedName(newName, spidersForProject);
			this.set('content.name', newName);
			this.get('slyd').renameSpider(oldName, newName).then(
				function() {
					this.replaceRoute('spider', newName);
				}.bind(this),
				function(reason) {
					this.set('name', oldName);
					this.showHTTPAlert('Save Error', reason);
				}.bind(this)
			);
		},

		testSpider: function() {
			if (this.get('testing')) {
				this.set('testing', false);
			} else {
				this.set('testing', true);
				this.get('documentView').showLoading();
				this.get('pendingFetches').setObjects([]);
				this.get('extractedItems').setObjects([]);
				this.set('showItems', true);
				this.testSpider(this.get('start_urls').copy());
			}
		},

		updateLoginInfo: function() {
			Ember.run.once(this, 'saveSpider');
		},
	},

	documentActions: {

		linkClicked: function(url) {
			this.get('documentView').showLoading();
			this.fetchPage(url, this.get('loadedPageFp'));
		}
	},

	willEnter: function() {
		this.set('loadedPageFp', null);
		this.get('extractedItems').setObjects([]);
		this.get('documentView').config({ mode: 'browse',
										  listener: this,
										  dataSource: this });
		this.get('documentView').showSpider();
		var newSpiderSite = this.get('controllers.application.siteWizard');
		if (newSpiderSite) {
			Ember.run.next(this, function() {
				this.addStartUrls(newSpiderSite);
				this.fetchPage(this.get('start_urls')[0]);
				this.set('controllers.application.siteWizard', null);
				Ember.run.once(this, 'saveSpider');
			});
		}
		if (this.get('autoloadTemplate')) {
			Ember.run.next(this, function() {
				this.saveSpider().then(function() {
					this.fetchPage(this.get('autoloadTemplate'), null, true);
					this.set('autoloadTemplate', null);
				}.bind(this));
			});
		}

		if (this.url) {
			this.fetchQueryUrl();
		}
	},

	willLeave: function() {
		this.get('pendingFetches').setObjects([]);
		this.get('documentView').hideLoading();
	},
});