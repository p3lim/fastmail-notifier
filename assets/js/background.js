var path = 'https://www.fastmail.com/';
var defaults = {
	'interval': 15,
	'notifications': true,
	'upgrade': 1
};

var updateNotifications = function(count){
	chrome.storage.sync.get('notifications', function(settings){
		if(settings.notifications){
			chrome.tabs.query({
				currentWindow: true,
				active: true,
				url: path + 'mail/*'
			}, function(tabs){
				if(!tabs.length){
					chrome.notifications.clear('fastmail-notifier', function(){
						chrome.notifications.create('fastmail-notifier', {
							type: 'basic',
							iconUrl: 'assets/images/icon128.png',
							title: 'FastMail',
							message: count + ' unread mail'
						}, function(){});
					});
				}
			});
		}
	});
};

var lastCount;
var updateBadge = function(count){
	if(typeof(count) === 'number'){
		chrome.browserAction.setIcon({path: 'assets/images/icon_enabled.png'});

		if(count > 0){
			chrome.browserAction.setBadgeBackgroundColor({color: '#D00018'});
			chrome.browserAction.setBadgeText({text: count.toString()});
		} else
			chrome.browserAction.setBadgeText({text: ''});

		if(lastCount !== count){
			if(count > lastCount && count > 0)
				updateNotifications(count);

			lastCount = count;
		}
	} else {
		chrome.browserAction.setIcon({path: 'assets/images/icon_disabled.png'});
		chrome.browserAction.setBadgeBackgroundColor({color: '#BBB'});
		chrome.browserAction.setBadgeText({text: '?'});
	}
};

var getUnreadResponse = function(){
	if(this.readyState === 4){
		if(this.status === 200){
			var counts = JSON.parse(this.response)[0][1].counts;

			var numUnread = 0;
			Object.keys(counts).forEach(function(key){
				var folder = counts[key];
				if(folder.unreadConversations && folder.unreadMessages){
					numUnread += folder.unreadConversations;
				}
			});

			updateBadge(numUnread);
		} else if(this.status === 403){
			localStorage.clear();
			updateBadge();
			queryToken();
		}
	}
};

var getUnread = function(){
	var token = localStorage.getItem('token');
	if(token){
		var xhr = new XMLHttpRequest();
		xhr.open('POST', path + 'api/?u=' + localStorage.getItem('user'));
		xhr.setRequestHeader('X-ME-Authorization', token);
		xhr.onreadystatechange = getUnreadResponse;
		xhr.send('[["getMailboxCounts"]]');
	} else
		updateBadge();
};

var querying;
var headersCallback = function(details){
	var headers = details.requestHeaders;
	for(var index = 0; index < headers.length; index++){
		var header = headers[index];
		if(header.name === 'X-ME-Authorization'){
			localStorage.setItem('token', header.value);
			localStorage.setItem('user', details.url.split('?u=')[1]);

			getUnread();
			break;
		}
	}

	chrome.webRequest.onBeforeSendHeaders.removeListener(headersCallback);
	querying = false;
};

var requestFilter = {
	urls: [path + 'api/?u=*'],
	types: ['xmlhttprequest']
};

var queryToken = function(){
	if(!querying){
		chrome.webRequest.onBeforeSendHeaders.addListener(
			headersCallback,
			requestFilter,
			['requestHeaders']
		);

		querying = true;
	}
};

var requestCallback = function(details){
	if(details.tabId === -1)
		return;

	if(details.hasOwnProperty('requestBody') && details.requestBody.hasOwnProperty('raw')){
		var bytes = new Uint8Array(details.requestBody.raw[0].bytes);
		var payload = JSON.parse(String.fromCharCode.apply(null, bytes));

		for(var index = 0; index < payload.length; index++){
			var method = payload[index]
			if(method[0] === 'getMailboxCounts' && method[1].hasOwnProperty('lastGeneration'))
				return setTimeout(getUnread, 1000);
		}
	}
};

var onInitialize = function(){
	chrome.storage.sync.get(null, function(settings){
		if(!settings.upgrade)
			chrome.storage.sync.set(defaults);
		else if(settings.upgrade < defaults.upgrade){
			for(var key in settings){
				if(defaults[key] === undefined)
					chrome.storage.sync.remove(key);
			}

			for(var key in defaults){
				if(!settings[key]){
					var obj = {}
					obj[key] = defaults[key];
					chrome.storage.sync.set(obj);
				}
			}

			chrome.storage.sync.set({
				upgrade: defaults.upgrade
			});
		}
	});

	chrome.storage.sync.get('interval', function(settings){
		chrome.alarms.create('fastmail-notifier', {
			periodInMinutes: settings.interval
		});
	});

	chrome.webRequest.onBeforeRequest.addListener(requestCallback, requestFilter, ['requestBody']);

	if(!localStorage.getItem('token'))
		queryToken();
	else
		getUnread();
};

chrome.runtime.onStartup.addListener(onInitialize);
chrome.runtime.onInstalled.addListener(onInitialize);

var openTab = function(){
	getUnread();

	chrome.tabs.query({
		currentWindow: true,
		url: path + 'mail/*'
	}, function(tabs){
		var tab = tabs[0];
		if(tab){
			chrome.tabs.update(tab.id, {active: true});

			if(!localStorage.getItem('token'))
				chrome.tabs.reload(tab.id);
		} else
			chrome.tabs.create({url: path});
	});
};

chrome.browserAction.onClicked.addListener(openTab);
chrome.notifications.onClicked.addListener(function(id){
	if(id === 'fastmail-notifier')
		openTab();
});

chrome.alarms.onAlarm.addListener(function(alarm){
	if(alarm.name === 'fastmail-notifier')
		getUnread();
});

chrome.storage.onChanged.addListener(function(changes){
	if(changes.interval){
		chrome.alarms.clear('fastmail-notifier');
		chrome.alarms.create('fastmail-notifier', {
			periodInMinutes: changes.interval.newValue
		});
	}
});
