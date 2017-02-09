import debounce from 'lodash.debounce';
import {subscribe} from 'redux-subscriber';
import {getSocketCredentials} from '../../utils/api';
import store from '../../redux/store';
import {login, logout} from '../../redux/actions/user';
import {loadMessagesCount} from '../../redux/actions/messages';
import {showNewNotification} from '../../redux/actions/notification';
import {RECONNECT, NEW_MESSAGE} from './constants';
import initWSClient from './client';

const config = {
    cookieTimeout: 1000,
    connectTryInterval: 10 * 1000, // 10 sec, try to connect if failed before
    maxConnectTryCount: 3, // try 3 times to connect before giving up
    reconnectInterval: 2 * 60 * 1000 // 2 min, just reconnect
};

let curConnectTryNumber = 0;
let wsClient, reconnectTimer;

async function connect() {
    const {dispatch} = store;

    clearTimeout(reconnectTimer);

    try {
        const credentials = await getSocketCredentials();

        // eslint-disable-next-line no-use-before-define
        reconnectTimer = setTimeout(reconnect, config.reconnectInterval);
        wsClient.connect(credentials);

        dispatch(loadMessagesCount());
        dispatch(login());

        curConnectTryNumber = 0;
    }
    catch (err) {
        dispatch(logout());

        if (++curConnectTryNumber < config.maxConnectTryCount) {
            setTimeout(connect, config.connectTryInterval);
        }
        else {
            curConnectTryNumber = 0;
            // throw unhandled exception for raven
            throw err;
        }
    }
}

const reconnect = debounce(() => {
    wsClient.disconnect();
    connect();
}, 500);

function disconnect() {
    clearTimeout(reconnectTimer);
    wsClient.disconnect();
}

function onNewMessage(data) {
    const {dispatch} = store;
    const {
        operation,
        new_messages: unreadCount,
        mid: id,
        hdr_status: status,
        hdr_from: from,
        hdr_subject: subject,
        firstline: message
    } = data;

    if (operation === 'insert' && status === 'New') {
        const nameMatch = from.match(/^"(.+)"/);
        const emailMatch = from.match(/<(.+)>$/);

        dispatch(loadMessagesCount(parseInt(unreadCount, 10)));
        dispatch(showNewNotification({
            id,
            from: nameMatch[1] || emailMatch[1],
            subject: subject !== 'No subject' ? subject : '',
            message
        }));
    }
    else {
        dispatch(loadMessagesCount());
    }
}

function emitEvent(eventType, data) {
    if (eventType === RECONNECT) {
        reconnect();
    }
    if (eventType === NEW_MESSAGE) {
        onNewMessage(data);
    }
}

export default function () {
    wsClient = initWSClient(emitEvent);

    subscribe('user.authorized', ({user: {authorized}}) => {
        if (authorized) {
           // UID might not be set immediately, this's why we delay it with timeout
            setTimeout(reconnect, config.cookieTimeout);
        }
        else {
            disconnect();
        }
    });
}