import React from 'react';
import firebase from 'firebase';
import 'firebase/firestore';
import _ from 'lodash';
import moment from 'moment';
import { Raw } from 'slate';
import { ipcRenderer } from 'electron';
import Howto from '../../../data/howto.json';
import taskListStorage from '../../modules/task-list-storage';
import Header from './header';
import Footer from './footer';
import TimelineViewport from './taskbord/timeline-viewport';
import CalendarViewport from './taskbord/calendar-viewport';
import TaskViewport from './taskbord/task-viewport';
import injectTapEventPlugin from 'react-tap-event-plugin';
import * as Constants from './constants';
import * as dateListUtil from '../../utils/date-list';
import * as taskListUtil from '../../utils/task-list';
injectTapEventPlugin();

// Initialize Cloud Firestore through Firebase
const db = firebase.firestore();

let intervalIds = [];
const HowtoContents = Raw.deserialize(Howto, { terse: true })
const today = moment().format("YYYYMMDD")
const storage = new taskListStorage()
const taskBoardDefaultState = {
  currentUser: null,
  date: today,
  taskList: taskListUtil.getTaskListByDate(moment().format("YYYYMMDD")),
  showHowto: false,
  nextTaskPositionTop: Constants.initialPositionTop,
  markerPositionTop: Constants.markerPositionTop(),
  showHistory: true,
  dateList: dateListUtil.getDateListWithTaskCount(Constants.initialDateList())
}

const taskBoardReducer = (state = taskBoardDefaultState, action) => {
  switch (action.type) {
    case 'UPDATE_CURRENT_USER':
      return {
        currentUser: action.currentUser
      };
    case 'UPDATE_TASK':
      return {
        taskList: action.taskList,
        nextTaskPositionTop: action.nextTaskPositionTop,
        dateList: action.dateList
      };
    case 'UPDATE_DATE':
      return {
        date: action.date,
        taskList: action.taskList,
        nextTaskPositionTop: action.nextTaskPositionTop,
        dateList: action.dateList,
        showHowto: false
      };
    case 'UPDATE_MARKER':
      return {
        markerPositionTop: Constants.markerPositionTop()
      };
    case 'UPDATE_DATE_LIST':
      return {
        dateList: action.dateList
      }
    case 'SHOW_HOWTO':
      return {
        taskList: HowtoContents,
        showHowto: true
      };
    case 'SHOW_HISTORY':
      return {
        showHistory: true
      };
    case 'HIDE_HISTORY':
      return {
        showHistory: false
      };
    default:
      return state;
  }
}

class TaskBoard extends React.Component {

  constructor(props){
    super(props);
    this.state = taskBoardDefaultState;
  }

  dispatch(action){
    console.log(action.type)
    this.setState(prevState => taskBoardReducer(prevState, action))
  }

  updateCurrentUser(currentUser){
    this.dispatch({ type: 'UPDATE_CURRENT_USER', currentUser: currentUser });
  }

  updateTask(taskList){
    this.dispatch({
      type: 'UPDATE_TASK',
      taskList: taskList,
      nextTaskPositionTop: this.getNextTaskPositionTop(taskList, this.state.date),
      dateList: this.getNextDateList(taskList, this.state.date)
    })
    if (! this.state.showHowto) storage.set(this.state.date, Raw.serialize(taskList).document)
  }

  updateDate(date){
    let nextTaskList = taskListUtil.getTaskListByDate(date)
    this.dispatch({
      type: 'UPDATE_DATE',
      date: date,
      taskList: nextTaskList,
      nextTaskPositionTop: this.getNextTaskPositionTop(nextTaskList, date),
      dateList: this.getNextDateList(nextTaskList, date)
    })
  }

  updateDateAndTask(date, taskList){
    this.dispatch({
      type: 'UPDATE_DATE',
      date: date,
      taskList: taskList,
      nextTaskPositionTop: this.getNextTaskPositionTop(taskList, date),
      dateList: this.getNextDateList(taskList, date)
    })
    if (! this.state.showHowto) storage.set(date, Raw.serialize(taskList).document)
  }

  updateDateList(dateList){
    this.dispatch({ type: 'UPDATE_DATE_LIST', dateList: dateList })
  }

  updateMarker(){
    this.dispatch({ type: 'UPDATE_MARKER' })
  }

  showHowtoContent(){
    this.dispatch({ type: 'SHOW_HOWTO' })
  }

  showHistoryMenu(){
    this.dispatch({ type: 'SHOW_HISTORY' })
  }

  hideHistoryMenu(){
    this.dispatch({ type: 'HIDE_HISTORY' })
  }

  getNextTaskPositionTop(taskList, date){
    let bottom = 450
    let requiredTime = 0
    let breaker = false
    let showInTimelineTaskCount = taskListUtil.getShowInTimelineTaskCount(taskList)
    let prevShowInTimelineTaskCount = taskListUtil.getShowInTimelineTaskCount(this.state.taskList)
    if (showInTimelineTaskCount == 0) {
      return Constants.initialPositionTop
    } else if (showInTimelineTaskCount == prevShowInTimelineTaskCount && date == this.state.date) {
      return this.state.nextTaskPositionTop
    } else {
      taskList.document.nodes.map((block) => {
        if (block.type == "separator") breaker = true
        if (breaker) return
        if (Constants.showInTimeline.includes(block.type) >= 0 && block.text != "") {
          if (block.data.get("positionTop") >= bottom) {
            bottom = block.data.get("positionTop")
            requiredTime = block.data.get("requiredTime")
          }
        }
      })
      if (bottom > 1200) bottom = 1200
    }
    return bottom + (Constants.heightPerHour * (requiredTime / 60))
  }

  getNextDateList(taskList, date){
    return this.state.showHowto ? this.state.dateList : dateListUtil.getDateListWithTaskCountByDate(this.state.dateList, taskList, date)
  }

  componentDidMount(){
    intervalIds.push(setInterval(() => { this.updateMarker() }, 60000));
    let prevTaskList, nextTaskList;
    intervalIds.push(setInterval(() => {
      nextTaskList = this.state.taskList;
      if(this.state.currentUser && nextTaskList != prevTaskList) {
        db.collection('users').doc(this.state.currentUser.uid).collection('dailyDocs').doc(this.state.date).set({
          content: JSON.stringify(Raw.serialize(this.state.taskList).document)
        })
        .then(function() {
          prevTaskList = nextTaskList;
          console.log('SAVE TO FIRESTORE');
        })
        .catch(function(error) {
          console.log(error)
          console.log('ERROR SAVING TO FIRESTORE');
        });
      }
    }, 10000));
  }

  componentWillMount(){
    this.updateCurrentUser(firebase.auth().currentUser);
  }

  componentWillUnmount(){
    _.each(intervalIds, (id) => {
      clearInterval(id);
    });
  }

  render() {
    return (
      <div id="task-board" className="wrapper">
        <div className="container-fluid">
          <div className="row">
            <CalendarViewport
              date={this.state.date}
              taskList={this.state.taskList}
              onUpdateCrrentUser={this.updateCurrentUser.bind(this)}
              onUpdateDate={this.updateDate.bind(this)}
              onUpdateDateList={this.updateDateList.bind(this)}
              showHistoryMenu={this.showHistoryMenu.bind(this)}
              hideHistoryMenu={this.hideHistoryMenu.bind(this)}
              dateList={this.state.dateList}
              showHistory={this.state.showHistory}
              currentUser={this.state.currentUser}
            />
            <TaskViewport
              date={this.state.date}
              taskList={this.state.taskList}
              nextTaskPositionTop={this.state.nextTaskPositionTop}
              onUpdateTask={this.updateTask.bind(this)}
              onUpdateDate={this.updateDate.bind(this)}
              onUpdateDateAndTask={this.updateDateAndTask.bind(this)}
              onClickShowHowto={this.showHowtoContent.bind(this)}
              showHowto={this.state.showHowto}
              markerPositionTop={this.state.markerPositionTop}
            />
            <TimelineViewport
              date={this.state.date}
              taskList={this.state.taskList}
              markerPositionTop={this.state.markerPositionTop}
              onUpdateTask={this.updateTask.bind(this)}
            />
          </div>
        </div>
      </div>
    );
  }
}

module.exports = class MainContent extends React.Component {
  render() {
    return(
      <div className="window">
        <div id="window-content" className="window-content">
          <Header></Header>
          <TaskBoard></TaskBoard>
          <Footer></Footer>
        </div>
      </div>
    );
  }
};
