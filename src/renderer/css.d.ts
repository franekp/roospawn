// instruct TS that, when we do
// import style from './style.css'
// CSS should be in string type
declare module '*.css' {
    const content: string;
    export default content;
}
